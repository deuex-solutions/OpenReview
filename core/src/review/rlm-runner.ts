import { randomUUID } from 'node:crypto';

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import { config } from '../config/env.js';
import { createMainLLM } from '../llm/router.js';
import { executeSandboxed } from '../sandbox/deno-runner.js';

import type { SnapshotBuilder } from './snapshot.js';
import type { PRContext, ReviewFinding } from './types.js';

/* ------------------------------------------------------------------ */
/*  State schema                                                       */
/* ------------------------------------------------------------------ */

const RLMState = Annotation.Root({
  messages: Annotation<Array<{ role: string; content: string }>>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  iterations: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  llmCalls: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  files: Annotation<Record<string, string>>({
    reducer: (_prev, next) => next,
    default: () => ({}),
  }),
  findings: Annotation<ReviewFinding[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  done: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
});

type RLMStateType = typeof RLMState.State;

/* ------------------------------------------------------------------ */
/*  Event emitter for streaming iteration updates                      */
/* ------------------------------------------------------------------ */

export type RLMEventType = 'iteration' | 'reasoning' | 'sandbox' | 'finalize';

export interface RLMEvent {
  type: RLMEventType;
  iteration: number;
  message: string;
}

export type RLMEventHandler = (event: RLMEvent) => void;

/* ------------------------------------------------------------------ */
/*  Node implementations                                               */
/* ------------------------------------------------------------------ */

function buildReasonNode(pr: PRContext, snapshot: SnapshotBuilder, onEvent?: RLMEventHandler) {
  const llm = createMainLLM();

  return async (state: RLMStateType) => {
    const iteration = state.iterations + 1;
    onEvent?.({ type: 'iteration', iteration, message: `Starting iteration ${iteration}` });

    const systemPrompt = buildRLMSystemPrompt(pr);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...state.messages,
      {
        role: 'human',
        content:
          `Iteration ${iteration}. ` +
          'Analyze the code and either:\n' +
          '1. Write a code block to investigate further (will be executed in a Deno sandbox)\n' +
          '2. Call finish_review if you have enough information\n\n' +
          'Available files in GLOBALS: ' +
          Object.keys(state.files).join(', ') +
          '\n\nYou can request additional files by outputting: FETCH_FILE: <path>',
      },
    ];

    const response = await llm.invoke(
      messages.map((m) => ({
        role: m.role as 'system' | 'human' | 'ai',
        content: m.content,
      })),
    );

    const responseText =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    onEvent?.({ type: 'reasoning', iteration, message: responseText.slice(0, 200) + '...' });

    // Check for file fetch requests
    const fetchRequests = extractFetchRequests(responseText);
    const updatedFiles = { ...state.files };
    for (const filePath of fetchRequests) {
      if (!(filePath in updatedFiles)) {
        const content = await snapshot.getFile(filePath);
        if (content) {
          updatedFiles[filePath] = content;
        }
      }
    }

    return {
      messages: [{ role: 'ai', content: responseText }],
      iterations: iteration,
      llmCalls: state.llmCalls + 1,
      files: updatedFiles,
      findings: state.findings,
      done: state.done,
    };
  };
}

function buildCodeWriterNode() {
  return async (state: RLMStateType) => {
    const lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage) return state;

    const codeBlock = extractCodeBlock(lastMessage.content);
    if (!codeBlock) {
      // No code to execute — pass through
      return {
        messages: [{ role: 'human', content: 'No code block found in reasoning output.' }],
        iterations: state.iterations,
        llmCalls: state.llmCalls,
        files: state.files,
        findings: state.findings,
        done: state.done,
      };
    }

    return {
      messages: [
        { role: 'human', content: `Code to execute:\n\`\`\`typescript\n${codeBlock}\n\`\`\`` },
      ],
      iterations: state.iterations,
      llmCalls: state.llmCalls,
      files: state.files,
      findings: state.findings,
      done: state.done,
    };
  };
}

function buildSandboxNode(onEvent?: RLMEventHandler) {
  return async (state: RLMStateType) => {
    const lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage) return state;

    const codeBlock = extractCodeBlock(lastMessage.content);
    if (!codeBlock) {
      return {
        messages: [{ role: 'human', content: 'No code to execute.' }],
        iterations: state.iterations,
        llmCalls: state.llmCalls,
        files: state.files,
        findings: state.findings,
        done: state.done,
      };
    }

    const result = await executeSandboxed(codeBlock, state.files);

    onEvent?.({
      type: 'sandbox',
      iteration: state.iterations,
      message: `Sandbox: exit=${result.exitCode} duration=${result.duration}ms`,
    });

    const output = [
      `Sandbox execution result (exit code: ${result.exitCode}, duration: ${result.duration}ms):`,
      '',
      result.stdout ? `STDOUT:\n${result.stdout}` : 'STDOUT: (empty)',
      '',
      result.stderr ? `STDERR:\n${result.stderr}` : 'STDERR: (empty)',
    ].join('\n');

    return {
      messages: [{ role: 'human', content: output }],
      iterations: state.iterations,
      llmCalls: state.llmCalls,
      files: state.files,
      findings: state.findings,
      done: state.done,
    };
  };
}

function buildObserveNode() {
  return async (state: RLMStateType) => {
    // Observe node simply passes sandbox output through to next iteration
    return {
      messages: [],
      iterations: state.iterations,
      llmCalls: state.llmCalls,
      files: state.files,
      findings: state.findings,
      done: state.done,
    };
  };
}

function buildFinalizeNode(pr: PRContext, onEvent?: RLMEventHandler) {
  const llm = createMainLLM();

  return async (state: RLMStateType) => {
    onEvent?.({
      type: 'finalize',
      iteration: state.iterations,
      message: 'Producing final findings from all observations',
    });

    const finalPrompt = [
      {
        role: 'system',
        content: buildFinalizationPrompt(),
      },
      ...state.messages,
      {
        role: 'human',
        content:
          `Based on all your analysis across ${state.iterations} iterations, ` +
          `produce the final review findings for PR #${pr.prNumber} in ${pr.owner}/${pr.repo}.\n\n` +
          'Respond ONLY with a valid JSON array of findings.',
      },
    ];

    const response = await llm.invoke(
      finalPrompt.map((m) => ({
        role: m.role as 'system' | 'human' | 'ai',
        content: m.content,
      })),
    );

    const responseText =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    const findings = parseRLMFindings(responseText);

    return {
      messages: [{ role: 'ai', content: responseText }],
      iterations: state.iterations,
      llmCalls: state.llmCalls + 1,
      files: state.files,
      findings,
      done: true,
    };
  };
}

/* ------------------------------------------------------------------ */
/*  Edge conditions                                                    */
/* ------------------------------------------------------------------ */

function shouldContinue(state: RLMStateType): 'finalize' | 'code_writer' {
  // Check iteration limit
  if (state.iterations >= config.maxIterations) {
    return 'finalize';
  }

  // Check LLM call limit
  if (state.llmCalls >= config.maxLlmCalls) {
    return 'finalize';
  }

  // Check if LLM called finish_review
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage && lastMessage.content.includes('finish_review')) {
    return 'finalize';
  }

  return 'code_writer';
}

/* ------------------------------------------------------------------ */
/*  Graph compilation + runner                                         */
/* ------------------------------------------------------------------ */

export async function runRLM(
  pr: PRContext,
  snapshot: SnapshotBuilder,
  onEvent?: RLMEventHandler,
): Promise<ReviewFinding[]> {
  // Pre-load diff files into the files map
  const initialFiles: Record<string, string> = {};
  const diffPaths = snapshot.getCachedPaths();
  for (const path of diffPaths) {
    const content = await snapshot.getFile(path);
    if (content) {
      initialFiles[path] = content;
    }
  }

  const graph = new StateGraph(RLMState)
    .addNode('reason', buildReasonNode(pr, snapshot, onEvent))
    .addNode('code_writer', buildCodeWriterNode())
    .addNode('sandbox', buildSandboxNode(onEvent))
    .addNode('observe', buildObserveNode())
    .addNode('finalize', buildFinalizeNode(pr, onEvent))
    .addEdge(START, 'reason')
    .addConditionalEdges('reason', shouldContinue, {
      code_writer: 'code_writer',
      finalize: 'finalize',
    })
    .addEdge('code_writer', 'sandbox')
    .addEdge('sandbox', 'observe')
    .addEdge('observe', 'reason')
    .addEdge('finalize', END)
    .compile();

  const result = await graph.invoke({
    messages: [
      {
        role: 'human',
        content:
          `Review PR #${pr.prNumber}: "${pr.metadata.title}" by ${pr.metadata.author}\n\n` +
          `Diff:\n\`\`\`diff\n${pr.diff}\n\`\`\``,
      },
    ],
    iterations: 0,
    llmCalls: 0,
    files: initialFiles,
    findings: [],
    done: false,
  });

  return result.findings;
}

/* ------------------------------------------------------------------ */
/*  Prompts                                                            */
/* ------------------------------------------------------------------ */

function buildRLMSystemPrompt(pr: PRContext): string {
  const parts = [
    'You are OpenReview RLM (Reason-Loop-Measure), a deep code analysis agent.',
    'You review code by iteratively reasoning, writing analysis scripts, and observing results.',
    '',
    'Your workflow:',
    '1. Reason about the code and identify areas to investigate',
    '2. Write TypeScript code blocks that will be executed in a Deno sandbox',
    '3. The code has access to `GLOBALS` object containing file contents',
    '4. Observe sandbox output and continue investigating or finalize',
    '',
    'To request additional files, output: FETCH_FILE: <path>',
    'To finish the review, output: finish_review',
    '',
    'Write investigative code that:',
    '- Parses file contents from GLOBALS',
    '- Checks for patterns, anti-patterns, or bugs',
    '- Outputs findings to stdout',
    '',
    `Repository: ${pr.owner}/${pr.repo}`,
    `PR #${pr.prNumber}: ${pr.metadata.title}`,
    `Author: ${pr.metadata.author}`,
  ];

  if (pr.instructions) {
    parts.push('', '## Project Review Instructions', pr.instructions);
  }

  if (pr.learnings.length > 0) {
    parts.push('', '## Team Learnings', ...pr.learnings.map((l) => `- ${l}`));
  }

  return parts.join('\n');
}

function buildFinalizationPrompt(): string {
  return [
    'You are OpenReview. Based on all the analysis performed across multiple iterations,',
    'produce the final review findings.',
    '',
    'Respond ONLY with a valid JSON array. Each finding must have this schema:',
    '```json',
    '[{',
    '  "category": "bug" | "flag",',
    '  "severity": "severe" | "non-severe" | "investigate" | "informational",',
    '  "file": "path/to/file.ts",',
    '  "startLine": 10,',
    '  "endLine": 12,',
    '  "title": "Short title",',
    '  "explanation": "Detailed explanation backed by sandbox observations",',
    '  "suggestedFix": "Optional corrected code",',
    '  "citations": [{"file": "path/to/file.ts", "startLine": 10, "endLine": 12}]',
    '}]',
    '```',
    '',
    'Rules:',
    '- Only report findings backed by evidence from your sandbox analysis.',
    '- Include citations pointing to the exact lines.',
    '- If no issues were found, respond with an empty array: []',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function extractCodeBlock(text: string): string | null {
  // Match ```typescript ... ``` or ```ts ... ``` or ``` ... ```
  const match = /```(?:typescript|ts)?\s*\n([\s\S]*?)\n```/.exec(text);
  return match ? match[1].trim() : null;
}

function extractFetchRequests(text: string): string[] {
  const matches = text.matchAll(/FETCH_FILE:\s*(.+)/g);
  return [...matches].map((m) => m[1].trim());
}

interface RawRLMFinding {
  category?: string;
  severity?: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  title?: string;
  explanation?: string;
  suggestedFix?: string;
  citations?: Array<{ file?: string; startLine?: number; endLine?: number }>;
}

function parseRLMFindings(text: string): ReviewFinding[] {
  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = /\[[\s\S]*\]/.exec(cleaned);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) return [];

  const findings: ReviewFinding[] = [];
  for (const item of parsed) {
    const raw = item as RawRLMFinding;
    if (!raw.file || !raw.startLine || !raw.title || !raw.explanation) continue;

    const category = raw.category === 'bug' ? 'bug' : 'flag';
    const severity = isValidSeverity(raw.severity) ? raw.severity : 'investigate';

    const citations = raw.citations
      ?.filter((c) => c.file && c.startLine)
      .map((c) => ({
        file: c.file!,
        startLine: c.startLine!,
        endLine: c.endLine ?? c.startLine!,
      })) ?? [{ file: raw.file, startLine: raw.startLine, endLine: raw.endLine ?? raw.startLine }];

    findings.push({
      id: `rlm-${randomUUID().slice(0, 8)}`,
      category,
      severity,
      file: raw.file,
      startLine: raw.startLine,
      endLine: raw.endLine ?? raw.startLine,
      title: raw.title,
      explanation: raw.explanation,
      suggestedFix: raw.suggestedFix,
      source: 'ai',
      citations,
    });
  }

  return findings;
}

function isValidSeverity(s?: string): s is ReviewFinding['severity'] {
  return s === 'severe' || s === 'non-severe' || s === 'investigate' || s === 'informational';
}
