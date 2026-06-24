import Link from 'next/link';
import {
  api, fmtCost, fmtTokens, fmtDate, fmtDuration,
  statusBadgeClass, executionBadgeClass,
  type PrRunSummary,
} from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ repoId: string }> }

export default async function RepoPage({ params }: Props) {
  const { repoId } = await params;

  const [runs, cost] = await Promise.all([
    api.repositories.prRuns(repoId).catch(() => [] as PrRunSummary[]),
    api.repositories.costSummary(repoId).catch(() => null),
  ]);

  const repoName = cost?.githubRepo ?? repoId;

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div className="breadcrumb">
          <Link href="/">Dashboard</Link>
          <span className="breadcrumb-sep">›</span>
          <span>{repoName}</span>
        </div>
        <h1>{repoName}</h1>
        <p>Coverage analysis runs and LLM cost breakdown for this repository</p>
      </div>

      {/* Cost Summary Stats */}
      {cost && (
        <div className="stats-bar" style={{ marginBottom: '32px' }}>
          <div className="stat-card">
            <div className="stat-label">Total Spend</div>
            <div className="stat-value" style={{ color: 'var(--accent)' }}>
              {fmtCost(cost.estimatedCostUsd)}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">LLM Calls</div>
            <div className="stat-value">{cost.totalCalls}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Tokens</div>
            <div className="stat-value">{fmtTokens(cost.totalTokens)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg per PR</div>
            <div className="stat-value" style={{ fontSize: '1.25rem' }}>
              {cost.byPr.length > 0
                ? fmtCost(cost.estimatedCostUsd / cost.byPr.length)
                : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Cost by Model */}
      {cost && cost.byModel.length > 0 && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-header">
            <span className="card-title">Cost by Model</span>
          </div>
          <div className="card-body table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Calls</th>
                  <th>Prompt Tokens</th>
                  <th>Completion Tokens</th>
                  <th>Total Tokens</th>
                  <th>Estimated Cost</th>
                </tr>
              </thead>
              <tbody>
                {cost.byModel.map((m) => (
                  <tr key={`${m.provider}::${m.modelName}`}>
                    <td>
                      <span style={{
                        background: m.provider === 'openai' ? 'var(--green-soft)' : 'var(--accent-soft)',
                        color: m.provider === 'openai' ? 'var(--green)' : 'var(--accent)',
                        padding: '2px 8px',
                        borderRadius: '20px',
                        fontSize: '.72rem',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                      }}>{m.provider}</span>
                    </td>
                    <td className="td-mono td-primary">{m.modelName}</td>
                    <td>{m.calls}</td>
                    <td className="td-mono">{fmtTokens(m.promptTokens)}</td>
                    <td className="td-mono">{fmtTokens(m.completionTokens)}</td>
                    <td className="td-mono">{fmtTokens(m.totalTokens)}</td>
                    <td className="td-cost">{fmtCost(m.estimatedCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PR Runs Table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">PR Runs ({runs.length})</span>
        </div>
        <div className="card-body">
          {runs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔍</div>
              <div className="empty-state-title">No PR runs yet</div>
              <div className="empty-state-sub">
                Runs appear here when a GitHub webhook triggers coverage analysis.
              </div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>PR</th>
                    <th>Status</th>
                    <th>Coverage Before</th>
                    <th>Coverage After</th>
                    <th>Tests Generated</th>
                    <th>Execution</th>
                    <th>Cost</th>
                    <th>Duration</th>
                    <th>Started</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <PrRunRow key={run.id} run={run} repoId={repoId} cost={cost} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PrRunRow({
  run,
  repoId,
  cost,
}: {
  run: PrRunSummary;
  repoId: string;
  cost: Awaited<ReturnType<typeof api.repositories.costSummary>> | null;
}) {
  const prCost = cost?.byPr.find((p) => p.prRunId === run.id);
  const covBefore = run.coverageResult?.beforeCoverage;
  const covAfter = run.coverageResult?.afterCoverage;

  let covDelta: React.ReactNode = '—';
  if (covBefore != null && covAfter != null) {
    const delta = covAfter - covBefore;
    const sign = delta > 0 ? '+' : '';
    const cls = delta > 0 ? 'cov-up' : delta < 0 ? 'cov-down' : 'cov-flat';
    covDelta = <span className={cls}>{sign}{delta.toFixed(1)}%</span>;
  }

  return (
    <tr>
      <td>
        <a
          href={`https://github.com/${repoId.includes('/') ? repoId : 'repo'}/pull/${run.prNumber}`}
          target="_blank"
          rel="noreferrer"
          className="pr-link"
        >
          #{run.prNumber}
        </a>
      </td>
      <td>
        <span className={`badge ${statusBadgeClass(run.status)}`}>
          <span className="badge-dot" />
          {run.status.replace(/_/g, ' ')}
        </span>
      </td>
      <td className="td-mono">
        {covBefore != null ? `${covBefore.toFixed(1)}%` : '—'}
      </td>
      <td>
        {covAfter != null ? (
          <span className="td-mono">{covAfter.toFixed(1)}%</span>
        ) : '—'}
        {' '}
        {covDelta}
      </td>
      <td className="td-primary">
        {run.coverageResult?.generatedTestsCount ?? '—'}
      </td>
      <td>
        {run.coverageResult ? (
          <span className={`badge ${executionBadgeClass(run.coverageResult.executionStatus)}`}>
            <span className="badge-dot" />
            {run.coverageResult.executionStatus}
          </span>
        ) : '—'}
      </td>
      <td>
        {prCost ? (
          <span className="cost-pill">💰 {fmtCost(prCost.estimatedCostUsd)}</span>
        ) : '—'}
      </td>
      <td className="td-mono" style={{ fontSize: '.78rem' }}>
        {fmtDuration(run.startedAt, run.completedAt)}
      </td>
      <td style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>
        {fmtDate(run.startedAt)}
      </td>
      <td>
        <Link href={`/runs/${run.id}`} className="btn btn-ghost" style={{ fontSize: '.75rem', padding: '5px 10px' }}>
          View →
        </Link>
      </td>
    </tr>
  );
}
