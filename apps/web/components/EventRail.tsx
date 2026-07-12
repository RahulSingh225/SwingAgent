/**
 * EventRail — right rail showing high-impact events (score ≥ 6).
 *
 * Server component — fetches events directly from DB.
 * Shows AI summary inline when available.
 * Full feed lives on /alerts.
 */

import Link from 'next/link';
import { db, schema } from '@/lib/db';
import { desc, gte } from 'drizzle-orm';

function timeAgo(dateStr: string | Date): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function sentimentBadgeClass(sentiment?: string): string {
  switch (sentiment) {
    case 'Bullish':
      return 'badge-bullish';
    case 'Bearish':
      return 'badge-bearish';
    default:
      return 'badge-neutral';
  }
}

export default async function EventRail() {
  const events = await db
    .select()
    .from(schema.events)
    .where(gte(schema.events.impactScore, 6))
    .orderBy(desc(schema.events.publishedAt))
    .limit(20);

  return (
    <div className="card" style={{ minHeight: 320 }} id="event-rail">
      <div className="card-header">
        <h2>Catalysts</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge badge-score">Score ≥ 6</span>
          <Link
            href="/alerts"
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none', fontSize: '0.68rem' }}
          >
            View all →
          </Link>
        </div>
      </div>
      <div className="card-body" style={{ padding: '8px 4px' }}>
        {events.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 16px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p>No high-impact events yet.</p>
          </div>
        ) : (
          <div className="event-rail">
            {events.map(ev => {
              const ai = ev.aiAnalysis as any;
              return (
                <a
                  key={ev.id}
                  href={ev.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="event-item"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    {/* Score indicator */}
                    <div
                      style={{
                        flexShrink: 0,
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        background:
                          ev.impactScore >= 8
                            ? 'var(--bullish-bg)'
                            : ev.impactScore >= 7
                              ? 'var(--neutral-bg)'
                              : 'var(--accent-dim)',
                        color:
                          ev.impactScore >= 8
                            ? 'var(--bullish)'
                            : ev.impactScore >= 7
                              ? 'var(--neutral)'
                              : 'var(--accent)',
                        border: `1px solid ${
                          ev.impactScore >= 8
                            ? 'rgba(52,211,153,0.2)'
                            : ev.impactScore >= 7
                              ? 'rgba(251,191,36,0.2)'
                              : 'rgba(52,211,153,0.15)'
                        }`,
                      }}
                    >
                      {ev.impactScore}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="event-title">{ev.title}</div>
                      <div className="event-meta">
                        {ev.ticker && (
                          <span
                            style={{
                              fontWeight: 700,
                              color: 'var(--text-primary)',
                              letterSpacing: '0.02em',
                            }}
                          >
                            {ev.ticker}
                          </span>
                        )}
                        <span>{timeAgo(ev.publishedAt)}</span>
                        <span style={{ textTransform: 'capitalize' }}>{ev.source.replace('_', ' ')}</span>
                        {ai?.sentiment && (
                          <span className={`badge ${sentimentBadgeClass(ai.sentiment)}`}>
                            {ai.sentiment}
                          </span>
                        )}
                      </div>
                      {ai?.summary && <div className="event-summary">{ai.summary}</div>}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
