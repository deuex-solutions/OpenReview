// @openreview/core — entry point
export const VERSION = '1.0.0';

// Config
export { config, loadConfig, validateConfig } from './config/env.js';
export type { OpenReviewConfig } from './config/env.js';
export { findInstructionFiles, loadInstructions } from './config/instructions.js';

// GitHub
export { GitHubClient, parsePRUrl } from './github/client.js';
export type { PRMetadata, PRFile, GitHubClientOptions } from './github/client.js';
export { parseDiff, detectMovesAndCopies, filterDiffs } from './github/diff.js';
export type { ParsedDiff, Hunk, Line, MoveEvent } from './github/diff.js';
export { CommentPoster } from './github/comments.js';

// Review
export { runFastReview } from './review/fast-review.js';
export { runRLM } from './review/rlm-runner.js';
export type { RLMEvent, RLMEventHandler, RLMEventType } from './review/rlm-runner.js';
export { SnapshotBuilder } from './review/snapshot.js';
export type { SnapshotOptions } from './review/snapshot.js';
export { runLinters, deduplicateFindings } from './review/linters.js';
export { formatInlineComment, formatSummaryComment } from './review/formatter.js';
export { sortFindings } from './review/types.js';
export type {
  ReviewFinding,
  ReviewSummary,
  PRContext,
  Citation,
  FindingCategory,
  FindingSeverity,
  FindingSource,
} from './review/types.js';

// Learnings
export {
  LearningsStore,
  containsTrigger,
  formatLearningsForPrompt,
} from './learnings/learnings-store.js';
export type { Learning } from './learnings/learnings-store.js';

// Chat
export { handleChatMention } from './chat/chat-handler.js';
export type { CommentEvent, ChatContext } from './chat/chat-handler.js';
export { generateSuggestions } from './chat/suggestions.js';

// Trace
export { TraceLogger } from './trace/logger.js';
export type { TraceEntry, TraceMeta } from './trace/logger.js';

// Sandbox
export { executeSandboxed, verifyDenoInstallation } from './sandbox/deno-runner.js';
export type { SandboxResult } from './sandbox/deno-runner.js';

// LLM
export {
  createLLM,
  createMainLLM,
  createStructuredLLM,
  createSubLLM,
  detectProvider,
  streamChat,
} from './llm/router.js';
export type { LLMProvider, LLMInfo } from './llm/router.js';
