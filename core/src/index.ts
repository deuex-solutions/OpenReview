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
export { CommentPoster, formatInlineComment, formatSummaryComment } from './github/comments.js';
export type { ReviewFinding, ReviewSummary, Severity } from './github/comments.js';

// LLM
export { createLLM, createMainLLM, createSubLLM, detectProvider, streamChat } from './llm/router.js';
export type { LLMProvider, LLMInfo } from './llm/router.js';
