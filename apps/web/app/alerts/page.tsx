/**
 * Alerts feed — full catalyst event stream (separate from the dashboard rail).
 *
 * Client component — uses /api/feed with minScore / limit filters.
 * Optional local search over ticker, title, company, keywords.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface AIAnalysis {
  aiScore?: number;
  summary?: string;
  sentiment?: 'Bullish' | 'Bearish' | 'Neutral';
  confidence?: 'High' | 'Medium' | 'Low';
  pricePrediction?: string;
  keyInsight?: string;
  riskFactors?: string;
  counterparty?: string;
  orderType?: string;
  revenueImpact?: string;
}

interface FeedEvent {
  id: string;
  source: string;
  title: string;
  link: string;
  snippet: string;
  publishedAt: string;
  ticker: string | null;
  companyName: string | null;
  sector: string | null;
  sectorTags: string[];
  matchedKeywords: string[];
  orderValue: number | null;
  orderValueUnit: string | null;
  contractType: string | null;
  impactScore: number;
  aiAnalysis: AIAnalysis | null;
}

const SCORE_PRESETS = [
  { label: 'All', value: 1 },
  { label: '≥ 6', value: 6 },
  { label: '≥ 7', value: 7 },
  { label: '≥ 8', value: 8 },
] as const;

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

function formatPublished(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function scoreStyle(score: number): { bg: string; color: string; border: string } {
  if (score >= 8) {
    return {
      bg: 'var(--bullish-bg)',
      color: 'var(--bullish)',
      border: 'rgba(52,211,153,0.2)',
    };
  }
  if (score >= 7) {
    return {
      bg: 'var(--neutral-bg)',
      color: 'var(--neutral)',
      border: 'rgba(251,191,36,0.2)',
    };
  }
  return {
    bg: 'var(--accent-dim)',
    color: 'var(--accent)',
    border: 'rgba(52,211,153,0.15)',
  };
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

function sourceLabel(source: string): string {
  return source.replace(/_/g, ' ');
}

export default function AlertsPage() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minScore, setMinScore] = useState(1);
  const [limit, setLimit] = useState(100);
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        minScore: String(minScore),
        limit: String(limit),
      });
      const res = await fetch(`/api/feed?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch (err) {
      console.error('[Alerts] fetch error:', err);
      setError(err instanceof Error ? err.message : String(err));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [minScore, limit]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter(ev => {
      const hay = [
        ev.ticker,
        ev.companyName,
        ev.title,
        ev.snippet,
        ev.sector,
        ...(ev.matchedKeywords ?? []),
        ...(ev.sectorTags ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [events, query]);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Alerts Feed</h1>
        <span className="page-subtitle">
          {loading
            ? 'Loading…'
            : `${filtered.length} event${filtered.length === 1 ? '' : 's'}${
                query.trim() ? ' matching' : ''
              }`}
        </span>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          className="card-body"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            alignItems: 'flex-end',
          }}
        >
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Impact score</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {SCORE_PRESETS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  className={`btn btn-sm ${minScore === p.value ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setMinScore(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group" style={{ margin: 0, minWidth: 120 }}>
            <label className="form-label" htmlFor="feed-limit">
              Limit
            </label>
            <select
              id="feed-limit"
              className="form-input"
              value={limit}
              onChange={e => setLimit(Number(e.target.value))}
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>

          <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 200 }}>
            <label className="form-label" htmlFor="feed-search">
              Search
            </label>
            <input
              id="feed-search"
              className="form-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ticker, title, keyword…"
            />
          </div>

          <button type="button" className="btn btn-ghost" onClick={fetchFeed} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {/* Feed list */}
      <div className="card" id="alerts-feed">
        <div className="card-header">
          <h2>Catalysts</h2>
          <span className="badge badge-score">
            minScore {minScore}
            {query.trim() ? ' · filtered' : ''}
          </span>
        </div>
        <div className="card-body" style={{ padding: loading || filtered.length === 0 ? 16 : '8px 4px' }}>
          {loading ? (
            <div className="empty-state">
              <div className="pulse-dot" />
              <p style={{ marginTop: 12 }}>Loading alerts…</p>
            </div>
          ) : error ? (
            <div className="empty-state" style={{ padding: '32px 16px' }}>
              <p style={{ color: 'var(--bearish)' }}>Failed to load feed: {error}</p>
              <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={fetchFeed}>
                Retry
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 16px' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={40} height={40}>
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <p style={{ marginTop: 12 }}>
                {events.length === 0
                  ? 'No events yet. Run feed ingestion or lower the score filter.'
                  : 'No events match your search.'}
              </p>
            </div>
          ) : (
            <div className="event-rail" style={{ maxHeight: 'none' }}>
              {filtered.map(ev => {
                const ai = ev.aiAnalysis;
                const s = scoreStyle(ev.impactScore);
                const expanded = expandedId === ev.id;

                return (
                  <article
                    key={ev.id}
                    className="event-item"
                    style={{ cursor: 'default' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div
                        style={{
                          flexShrink: 0,
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          background: s.bg,
                          color: s.color,
                          border: `1px solid ${s.border}`,
                        }}
                        title={`Impact score ${ev.impactScore}`}
                      >
                        {ev.impactScore}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <a
                          href={ev.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="event-title"
                          style={{
                            textDecoration: 'none',
                            color: 'inherit',
                            display: expanded ? 'block' : undefined,
                            WebkitLineClamp: expanded ? undefined : 2,
                          }}
                        >
                          {ev.title}
                        </a>

                        <div className="event-meta" style={{ flexWrap: 'wrap' }}>
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
                          {ev.companyName && !ev.ticker && (
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                              {ev.companyName}
                            </span>
                          )}
                          <span title={formatPublished(ev.publishedAt)}>{timeAgo(ev.publishedAt)}</span>
                          <span style={{ textTransform: 'capitalize' }}>{sourceLabel(ev.source)}</span>
                          {ev.sector && <span>{ev.sector}</span>}
                          {ev.orderValue != null && (
                            <span>
                              ₹{ev.orderValue}
                              {ev.orderValueUnit ? ` ${ev.orderValueUnit}` : ''}
                            </span>
                          )}
                          {ai?.sentiment && (
                            <span className={`badge ${sentimentBadgeClass(ai.sentiment)}`}>
                              {ai.sentiment}
                            </span>
                          )}
                          {ai?.confidence && (
                            <span className="badge badge-score">{ai.confidence} conf.</span>
                          )}
                        </div>

                        {ai?.summary && (
                          <div className="event-summary">{ai.summary}</div>
                        )}

                        {!ai?.summary && ev.snippet && (
                          <div
                            className="event-summary"
                            style={{ borderLeftColor: 'var(--border-medium)' }}
                          >
                            {ev.snippet}
                          </div>
                        )}

                        {expanded && (
                          <div
                            style={{
                              marginTop: 12,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 8,
                              fontSize: '0.78rem',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {ai?.keyInsight && (
                              <div>
                                <strong style={{ color: 'var(--text-primary)' }}>Key insight: </strong>
                                {ai.keyInsight}
                              </div>
                            )}
                            {ai?.pricePrediction && (
                              <div>
                                <strong style={{ color: 'var(--text-primary)' }}>Price: </strong>
                                {ai.pricePrediction}
                              </div>
                            )}
                            {ai?.riskFactors && (
                              <div>
                                <strong style={{ color: 'var(--text-primary)' }}>Risks: </strong>
                                {ai.riskFactors}
                              </div>
                            )}
                            {ai?.revenueImpact && (
                              <div>
                                <strong style={{ color: 'var(--text-primary)' }}>Revenue: </strong>
                                {ai.revenueImpact}
                              </div>
                            )}
                            {ev.matchedKeywords?.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                                {ev.matchedKeywords.map(kw => (
                                  <span key={kw} className="badge badge-score">
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>
                              {formatPublished(ev.publishedAt)}
                              {ev.companyName && ev.ticker ? ` · ${ev.companyName}` : ''}
                            </div>
                          </div>
                        )}

                        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setExpandedId(expanded ? null : ev.id)}
                          >
                            {expanded ? 'Less' : 'Details'}
                          </button>
                          <a
                            href={ev.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-ghost btn-sm"
                            style={{ textDecoration: 'none' }}
                          >
                            Open source ↗
                          </a>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
