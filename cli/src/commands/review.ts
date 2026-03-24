import {
  CommentPoster,
  GitHubClient,
  SnapshotBuilder,
  loadConfig,
  parseDiff,
  runFastReview,
  runRLM,
  validateConfig,
} from '@openreview/core';
import type { PRContext, ReviewFinding, ReviewSummary } from '@openreview/core';
import type { Command } from 'commander';

import { formatJSON, formatMarkdown, formatText } from '../formatter.js';

export function registerReviewCommand(program: Command): void {
  program
    .command('review')
    .description('Review a GitHub Pull Request')
    .requiredOption('--url <url>', 'GitHub PR URL')
    .option('--mode <mode>', 'Review mode: fast or rlm', 'fast')
    .option('--output <format>', 'Output format: text, markdown, or json', 'text')
    .option('--model <model>', 'Override LLM model')
    .option('--expert', 'Comprehensive SOLID/security/quality review')
    .option('--submit', 'Post findings as GitHub PR comment')
    .option('--quiet', 'Suppress progress output')
    .action(async (opts) => {
      try {
        const cfg = loadConfig();
        validateConfig(cfg);

        if (opts.model) {
          (cfg as unknown as Record<string, unknown>).mainModel = opts.model;
        }

        const { client, prNumber } = GitHubClient.fromPRUrl(opts.url);

        if (!opts.quiet) {
          process.stderr.write(`Fetching PR #${prNumber}...\n`);
        }

        const prMeta = await client.getPR(prNumber);
        const files = await client.getPRFiles(prNumber);
        const diff = await client.getPRDiff(prNumber);

        const expertInstructions = opts.expert
          ? [
              'Perform a comprehensive expert review covering:',
              '- SOLID principles (single responsibility, open-closed, Liskov substitution, interface segregation, dependency inversion)',
              '- Security: OWASP Top 10, injection flaws, auth/authz issues, data exposure',
              '- Code quality: complexity, readability, maintainability, test coverage gaps',
              '- Performance: algorithmic complexity, resource leaks, unnecessary allocations',
            ].join('\n')
          : '';

        const prContext: PRContext = {
          owner: client.owner,
          repo: client.repo,
          prNumber,
          metadata: {
            title: prMeta.title,
            body: prMeta.body,
            headSha: prMeta.head.sha,
            baseSha: prMeta.base.sha,
            author: prMeta.user.login,
          },
          diff,
          files: files.map((f) => f.filename),
          instructions: expertInstructions,
          learnings: [],
        };

        let findings: ReviewFinding[];
        let summary: ReviewSummary;

        if (opts.mode === 'rlm') {
          if (!opts.quiet) {
            process.stderr.write('Running RLM deep review...\n');
          }

          const parsedDiffs = parseDiff(diff);
          const snapshot = new SnapshotBuilder({
            client,
            headRef: prMeta.head.sha,
            diffs: parsedDiffs,
          });

          findings = await runRLM(prContext, snapshot, (event) => {
            if (!opts.quiet) {
              process.stderr.write(
                `  [${event.type}] iter=${event.iteration}: ${event.message.slice(0, 80)}\n`,
              );
            }
          });

          const bySeverity = { severe: 0, 'non-severe': 0, investigate: 0, informational: 0 };
          for (const f of findings) {
            bySeverity[f.severity]++;
          }
          summary = {
            filesReviewed: files.length,
            duration: '—',
            mode: 'rlm',
            findingsBySeverity: bySeverity,
            totalFindings: findings.length,
          };
        } else {
          if (!opts.quiet) {
            process.stderr.write('Running fast review...\n');
          }

          const result = await runFastReview(prContext);
          findings = result.findings;
          summary = result.summary;
        }

        // Format and print output
        const format = opts.output as string;
        let output: string;
        if (format === 'json') {
          output = formatJSON(findings, summary);
        } else if (format === 'markdown') {
          output = formatMarkdown(findings, summary);
        } else {
          output = formatText(findings, summary);
        }

        process.stdout.write(output + '\n');

        // Post to GitHub if --submit flag is set
        if (opts.submit) {
          if (!opts.quiet) {
            process.stderr.write('Posting review to GitHub...\n');
          }

          const poster = new CommentPoster(client);

          if (findings.length > 0) {
            await poster.postReview(prNumber, findings);
          }

          await poster.postSummaryComment(prNumber, summary);

          process.stderr.write(
            `✅ Review posted on PR #${prNumber} (${findings.length} finding${findings.length === 1 ? '' : 's'})\n`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${msg}\n`);
        process.exit(1);
      }
    });
}
