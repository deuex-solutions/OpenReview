import Link from 'next/link';
import { api, fmtCost, fmtDate, fmtDuration, fmtTokens, statusBadgeClass, executionBadgeClass } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ runId: string }> }

export default async function PrRunPage({ params }: Props) {
  const { runId } = await params;
  const run = await api.prRuns.get(runId).catch(() => null);

  if (!run) {
    return (
      <div className="page-wrapper">
        <div className="empty-state" style={{ paddingTop: '120px' }}>
          <div className="empty-state-icon">❌</div>
          <div className="empty-state-title">PR run not found</div>
          <div className="empty-state-sub">The run may have been deleted or the ID is incorrect.</div>
          <Link href="/" className="btn btn-ghost" style={{ marginTop: '8px' }}>← Back to Dashboard</Link>
        </div>
      </div>
    );
  }

  const covDelta = run.coverageAfter != null && run.coverageBefore != null
    ? run.coverageAfter - run.coverageBefore
    : null;

  const workflow = run.workflowSummary as {
    attempts?: number;
    targetCoverage?: number;
    currentCoverage?: number;
    status?: string;
  } | null;

  return (
    <div className="page-wrapper">
      <div className="page-header">
        <div className="breadcrumb">
          <Link href="/">Dashboard</Link>
          <span className="breadcrumb-sep">›</span>
          <Link href={`/repos/${encodeURIComponent(run.repository)}`}>{run.repository}</Link>
          <span className="breadcrumb-sep">›</span>
          <span>PR #{run.prNumber}</span>
        </div>
        <h1>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>{run.repository} </span>
          PR #{run.prNumber}
        </h1>
        <div style={{ display: 'flex', gap: '10px', marginTop: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge ${statusBadgeClass(run.status)}`}>
            <span className="badge-dot" />
            {run.status.replace(/_/g, ' ')}
          </span>
          {run.executionStatus !== 'SKIPPED' && (
            <span className={`badge ${executionBadgeClass(run.executionStatus)}`}>
              <span className="badge-dot" />
              Tests {run.executionStatus}
            </span>
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: '.825rem' }}>
            {fmtDuration(run.startedAt, run.completedAt)}
          </span>
        </div>
      </div>

      {/* Stats Row */}
      <div className="stats-bar" style={{ marginBottom: '28px' }}>
        <div className="stat-card">
          <div className="stat-label">Coverage Before</div>
          <div className="stat-value td-mono">
            {run.coverageBefore != null ? `${run.coverageBefore.toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Coverage After</div>
          <div className="stat-value td-mono">
            {run.coverageAfter != null ? `${run.coverageAfter.toFixed(1)}%` : '—'}
          </div>
          {covDelta != null && (
            <div className={`stat-sub ${covDelta >= 0 ? 'cov-up' : 'cov-down'}`}>
              {covDelta >= 0 ? '+' : ''}{covDelta.toFixed(1)}%
            </div>
          )}
        </div>
        <div className="stat-card">
          <div className="stat-label">Diff Coverage Before</div>
          <div className="stat-value td-mono">
            {run.diffCoverageBefore != null ? `${run.diffCoverageBefore.toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Diff Coverage After</div>
          <div className="stat-value td-mono">
            {run.diffCoverageAfter != null ? `${run.diffCoverageAfter.toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Tests Generated</div>
          <div className="stat-value">{run.generatedTestsCount}</div>
        </div>
        {workflow && (
          <div className="stat-card">
            <div className="stat-label">LLM Attempts</div>
            <div className="stat-value">{workflow.attempts ?? '—'}</div>
          </div>
        )}
      </div>

      {/* Details */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        {/* Run Info */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Run Details</span>
          </div>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <div className="detail-item-label">Run ID</div>
              <div className="detail-item-value td-mono" style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{run.id}</div>
            </div>
            <div>
              <div className="detail-item-label">Started</div>
              <div className="detail-item-value">{fmtDate(run.startedAt)}</div>
            </div>
            <div>
              <div className="detail-item-label">Completed</div>
              <div className="detail-item-value">{fmtDate(run.completedAt)}</div>
            </div>
            <div>
              <div className="detail-item-label">Files Improved</div>
              <div className="detail-item-value">
                {run.filesImproved.length > 0
                  ? run.filesImproved.map((f) => (
                      <div key={f} style={{ fontSize: '.78rem', color: 'var(--green)', fontFamily: 'monospace' }}>{f}</div>
                    ))
                  : <span style={{ color: 'var(--text-muted)' }}>None</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Generated Tests */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Generated Test Files</span>
          </div>
          {run.generatedTestFiles.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 24px' }}>
              <div className="empty-state-icon" style={{ fontSize: '1.5rem' }}>📄</div>
              <div className="empty-state-sub">No test files generated</div>
            </div>
          ) : (
            <div style={{ padding: '0' }}>
              {run.generatedTestFiles.map((f) => (
                <div key={f.id} style={{
                  padding: '14px 24px',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}>
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: '.8rem', color: 'var(--text-primary)' }}>
                      {f.filePath.split('/').pop()}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: '.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      → {f.targetFile}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {f.passed != null ? (
                      <span className={`badge ${f.passed ? 'badge-pass' : 'badge-fail'}`}>
                        <span className="badge-dot" />
                        {f.passed ? 'PASS' : 'FAIL'}
                      </span>
                    ) : <span className="badge badge-skipped"><span className="badge-dot" />—</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Execution Logs */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Execution Logs ({run.logs.length})</span>
        </div>
        {run.logs.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px' }}>
            <div className="empty-state-sub">No logs available</div>
          </div>
        ) : (
          <div className="log-list">
            {run.logs.map((log, i) => (
              <div key={i} className="log-entry">
                <span className="log-time">{new Date(log.createdAt).toLocaleTimeString()}</span>
                <span className={`log-level-${log.level}`}>[{log.level.toUpperCase()}]</span>
                <span className="log-msg">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
