import Link from 'next/link';
import { api, fmtCost, fmtTokens } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [repos, globalStats] = await Promise.all([
    api.repositories.list().catch(() => []),
    api.stats.global().catch(() => null),
  ]);

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <h1>Coverage Dashboard</h1>
        <p>Monitor code coverage analysis and LLM spend across all your repositories</p>
      </div>

      {/* Global Stats Bar */}
      <div className="stats-bar">
        <div className="stat-card">
          <div className="stat-label">Repositories</div>
          <div className="stat-value">{globalStats?.totalRepositories ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">PR Runs</div>
          <div className="stat-value">{globalStats?.totalPrRuns ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Test Gen Runs</div>
          <div className="stat-value">{globalStats?.totalTestGenerationRuns ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">LLM Calls</div>
          <div className="stat-value">{globalStats?.totalLlmCalls ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Tokens</div>
          <div className="stat-value">{fmtTokens(globalStats?.totalTokens)}</div>
          <div className="stat-sub">across all runs</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Spend</div>
          <div className="stat-value" style={{ color: 'var(--accent)' }}>
            {fmtCost(globalStats?.estimatedCostUsd)}
          </div>
          <div className="stat-sub">estimated USD</div>
        </div>
      </div>

      {/* Repository Grid */}
      {repos.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🗂️</div>
          <div className="empty-state-title">No repositories registered yet</div>
          <div className="empty-state-sub">
            Register a repository via the API or connect a GitHub webhook to get started.
          </div>
        </div>
      ) : (
        <div>
          <div className="section-header">
            <span className="section-title">Repositories ({repos.length})</span>
          </div>
          <div className="repo-grid">
            {repos.map((repo) => (
              <RepoCard key={repo.id} repo={repo} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

async function RepoCard({ repo }: { repo: Awaited<ReturnType<typeof api.repositories.list>>[number] }) {
  const cost = await api.repositories.costSummary(repo.id).catch(() => null);

  return (
    <Link href={`/repos/${repo.id}`} className="repo-card">
      <div>
        <div className="repo-name">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
          </svg>
          {repo.githubRepo}
        </div>
      </div>

      <div className="repo-meta">
        <span className="repo-meta-item">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
            <path d="M18 9a9 9 0 0 1-9 9"/>
          </svg>
          {repo.defaultBranch}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {cost ? (
          <span className="repo-cost-badge">
            💰 {fmtCost(cost.estimatedCostUsd)} · {fmtTokens(cost.totalTokens)} tokens
          </span>
        ) : (
          <span className="repo-cost-badge" style={{ opacity: 0.4 }}>💰 No LLM data yet</span>
        )}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </Link>
  );
}
