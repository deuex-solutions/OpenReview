import { config as coreConfig } from '@openreview/core';
import type { ReviewFinding } from '@openreview/core';
import type { Redis } from 'ioredis';

import type { ServiceConfig } from '../config.js';
import type { Logger } from '../logger.js';

const CACHE_VERSION = 'v1';

export interface CachedReviewResult {
  findings: ReviewFinding[];
  model: string;
  cachedAt: string;
}

export class ReviewCache {
  constructor(
    private readonly redis: Redis,
    private readonly cfg: ServiceConfig,
    private readonly log: Logger,
  ) {}

  isEnabled(): boolean {
    return this.cfg.reviewCacheEnabled;
  }

  async get(
    owner: string,
    repo: string,
    fingerprint: string,
  ): Promise<CachedReviewResult | null> {
    if (!this.isEnabled()) return null;

    const key = this.cacheKey(owner, repo, fingerprint);
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as CachedReviewResult;
      if (!Array.isArray(parsed.findings)) return null;

      this.log.info(
        { fingerprint: fingerprint.slice(0, 12), model: parsed.model },
        'review cache hit',
      );
      return parsed;
    } catch (err) {
      this.log.warn(
        { err: (err as Error).message, fingerprint: fingerprint.slice(0, 12) },
        'review cache read failed',
      );
      return null;
    }
  }

  async set(
    owner: string,
    repo: string,
    fingerprint: string,
    findings: ReviewFinding[],
  ): Promise<void> {
    if (!this.isEnabled()) return;

    const payload: CachedReviewResult = {
      findings,
      model: coreConfig.mainModel,
      cachedAt: new Date().toISOString(),
    };

    const key = this.cacheKey(owner, repo, fingerprint);
    try {
      await this.redis.set(key, JSON.stringify(payload), 'EX', this.cfg.reviewCacheTtlSeconds);
      this.log.info(
        { fingerprint: fingerprint.slice(0, 12), findings: findings.length },
        'review cache stored',
      );
    } catch (err) {
      this.log.warn(
        { err: (err as Error).message, fingerprint: fingerprint.slice(0, 12) },
        'review cache write failed',
      );
    }
  }

  private cacheKey(owner: string, repo: string, fingerprint: string): string {
    return `openreview:review-cache:${CACHE_VERSION}:${owner}/${repo}:${coreConfig.mainModel}:${fingerprint}`;
  }
}
