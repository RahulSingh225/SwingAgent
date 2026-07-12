/**
 * CandidatesTable — tonight's screener output with per-screener toggles.
 *
 * Client component — fetches from /api/candidates with setup/direction filters.
 * Each screener has a long/short toggle chip.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

interface Candidate {
  date: string;
  ticker: string;
  setupName: string;
  screenValues: Record<string, number | string>;
  catalystEventId: string | null;
  companyName: string | null;
  sector: string | null;
  catalyst: {
    id: string;
    title: string;
    impactScore: number;
  } | null;
}

interface CandidatesResponse {
  date: string;
  count: number;
  setupCounts: Record<string, number>;
  candidates: Candidate[];
}

const SETUPS = [
  { key: 'confluence', label: 'Confluence' },
  { key: 'dma-pullback', label: '20 DMA' },
  { key: 'rsi-reaction', label: 'RSI(7)' },
  { key: 'stoch-reaction', label: 'Stoch(7,10)' },
];

function formatNum(val: number | null | undefined, decimals = 2): string {
  if (val == null) return '—';
  return Number(val).toFixed(decimals);
}

function directionFromSetup(setupName: string): 'long' | 'short' {
  return setupName.includes('-short') ? 'short' : 'long';
}

export default function CandidatesTable() {
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Filter state — per-setup toggles
  const [activeSetups, setActiveSetups] = useState<Set<string>>(
    new Set(SETUPS.map(s => s.key)),
  );
  const [directionFilter, setDirectionFilter] = useState<'all' | 'long' | 'short'>('all');

  const fetchCandidates = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/candidates');
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('[CandidatesTable] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  const toggleSetup = (key: string) => {
    setActiveSetups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Filter candidates by active setups + direction
  const filtered = (data?.candidates ?? []).filter(c => {
    const setupBase = c.setupName.replace(/-long@.*/, '').replace(/-short@.*/, '');
    if (!activeSetups.has(setupBase)) return false;
    if (directionFilter !== 'all') {
      const dir = directionFromSetup(c.setupName);
      if (dir !== directionFilter) return false;
    }
    return true;
  });

  return (
    <div className="card" id="candidates-table">
      <div className="card-header" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h2>Tonight&apos;s Candidates</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Direction toggle */}
          <div style={{
            display: 'flex',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            border: '1px solid var(--border-subtle)',
          }}>
            {(['all', 'long', 'short'] as const).map(d => (
              <button
                key={d}
                onClick={() => setDirectionFilter(d)}
                className={directionFilter === d ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
                style={{
                  borderRadius: 0,
                  border: 'none',
                  textTransform: 'capitalize',
                  ...(directionFilter === d ? {} : { background: 'transparent' }),
                }}
              >
                {d === 'all' ? 'All' : d === 'long' ? '↑ Long' : '↓ Short'}
              </button>
            ))}
          </div>

          <div style={{ width: 1, height: 20, background: 'var(--border-subtle)' }} />

          {/* Per-setup toggles */}
          {SETUPS.map(s => {
            const active = activeSetups.has(s.key);
            const count = (data?.candidates ?? []).filter(c =>
              c.setupName.startsWith(s.key),
            ).length;
            return (
              <button
                key={s.key}
                onClick={() => toggleSetup(s.key)}
                className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                style={{ position: 'relative' }}
              >
                {s.label}
                {count > 0 && (
                  <span style={{
                    marginLeft: 4,
                    fontSize: '0.6rem',
                    fontWeight: 800,
                    opacity: 0.8,
                  }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}

          <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginLeft: 4 }}>
            {data?.date ?? ''} · {filtered.length} showing
          </span>
        </div>
      </div>

      <div className="card-body" style={{ padding: 0 }}>
        {loading ? (
          <div className="empty-state">
            <div className="pulse-dot" />
            <p style={{ marginTop: 12 }}>Loading candidates…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px 16px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
            </svg>
            <p>
              {data && data.count > 0
                ? 'No candidates match the current filters.'
                : 'No candidates for tonight — screener runs at 19:45 IST after bhavcopy.'}
            </p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th>Setup</th>
                  <th>Dir</th>
                  <th>Close</th>
                  <th>ROC(20)</th>
                  <th>RSI(7)</th>
                  <th>Stoch K</th>
                  <th>Trend</th>
                  <th>Catalyst</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const sv = row.screenValues;
                  const dir = directionFromSetup(row.setupName);
                  const setupLabel = row.setupName.split('@')[0];

                  return (
                    <tr key={`${row.ticker}-${row.setupName}-${i}`}>
                      <td className="ticker-cell">{row.ticker}</td>
                      <td style={{
                        color: 'var(--text-secondary)',
                        maxWidth: 140,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {row.companyName ?? '—'}
                      </td>
                      <td>
                        <span className={`badge ${
                          setupLabel.includes('confluence')
                            ? 'badge-bullish'
                            : 'badge-score'
                        }`}>
                          {setupLabel}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${dir === 'long' ? 'badge-bullish' : 'badge-bearish'}`}>
                          {dir === 'long' ? '↑' : '↓'} {dir}
                        </span>
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        ₹{formatNum(sv.close as number)}
                      </td>
                      <td style={{
                        color: (sv.roc20 as number) >= 0 ? 'var(--bullish)' : 'var(--bearish)',
                        fontWeight: 600,
                      }}>
                        {sv.roc20 != null ? `${(sv.roc20 as number) >= 0 ? '+' : ''}${formatNum(sv.roc20 as number)}%` : '—'}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {sv.rsi7 != null ? formatNum(sv.rsi7 as number, 1) : '—'}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {sv.stochK != null ? formatNum(sv.stochK as number, 1) : '—'}
                      </td>
                      <td>
                        <span className={`badge ${
                          sv.weeklyTrend === 'UP'
                            ? 'badge-bullish'
                            : sv.weeklyTrend === 'DOWN'
                              ? 'badge-bearish'
                              : 'badge-neutral'
                        }`}>
                          {sv.weeklyTrend ?? '—'}
                        </span>
                      </td>
                      <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.catalyst ? (
                          <span
                            title={row.catalyst.title}
                            style={{
                              fontSize: '0.72rem',
                              color: 'var(--text-secondary)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <span className="badge badge-score" style={{ fontSize: '0.6rem' }}>
                              {row.catalyst.impactScore}
                            </span>
                            {row.catalyst.title.slice(0, 45)}…
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-dim)' }}>—</span>
                        )}
                      </td>
                      <td>
                        <Link
                          href={`/journal?ticker=${row.ticker}&setup=${row.setupName}${row.catalystEventId ? `&catalyst=${row.catalystEventId}` : ''}`}
                          className="btn btn-ghost btn-sm"
                          style={{ textDecoration: 'none' }}
                        >
                          Journal it
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
