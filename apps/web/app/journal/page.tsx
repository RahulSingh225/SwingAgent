/**
 * Journal — trade entry form + position-size calculator + trade list.
 *
 * Client component — uses /api/trades for CRUD, supports pre-filling
 * from candidates table via URL params (?ticker=X&setup=Y&catalyst=Z).
 */

'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

interface Trade {
  id: number;
  ticker: string;
  direction: string;
  entry: number;
  stop: number;
  target: number | null;
  qty: number;
  thesis: string;
  setupName: string | null;
  catalystEventId: string | null;
  openedAt: string;
  closedAt: string | null;
  exitPrice: number | null;
  rMultiple: number | null;
}

interface TradesResponse {
  count: number;
  openCount: number;
  closedCount: number;
  avgRMultiple: number | null;
  winRate: number | null;
  trades: Trade[];
}

function JournalContent() {
  const searchParams = useSearchParams();
  const [trades, setTrades] = useState<TradesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [ticker, setTicker] = useState(searchParams.get('ticker') ?? '');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [thesis, setThesis] = useState('');
  const [setupName, setSetupName] = useState(searchParams.get('setup') ?? '');
  const [catalystEventId] = useState(searchParams.get('catalyst') ?? '');

  // Position-size calculator
  const [capital, setCapital] = useState('500000');
  const [riskPct, setRiskPct] = useState('1');

  // Computed
  const entryNum = parseFloat(entry) || 0;
  const stopNum = parseFloat(stop) || 0;
  const capitalNum = parseFloat(capital) || 0;
  const riskPctNum = parseFloat(riskPct) || 0;
  const riskPerShare = Math.abs(entryNum - stopNum);
  const riskAmount = capitalNum * (riskPctNum / 100);
  const computedQty = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;
  const positionValue = computedQty * entryNum;

  // Close trade modal state
  const [closingId, setClosingId] = useState<number | null>(null);
  const [exitPrice, setExitPrice] = useState('');

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch('/api/trades');
      const data = await res.json();
      setTrades(data);
    } catch (err) {
      console.error('[Journal] fetch trades error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker || !entry || !stop || !thesis) return;

    try {
      await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: ticker.toUpperCase(),
          direction,
          entry: entryNum,
          stop: stopNum,
          target: parseFloat(target) || undefined,
          qty: computedQty,
          thesis,
          setupName: setupName || undefined,
          catalystEventId: catalystEventId || undefined,
        }),
      });
      // Reset form
      setTicker('');
      setEntry('');
      setStop('');
      setTarget('');
      setThesis('');
      setSetupName('');
      fetchTrades();
    } catch (err) {
      console.error('[Journal] create trade error:', err);
    }
  };

  const handleClose = async () => {
    if (!closingId || !exitPrice) return;
    try {
      await fetch('/api/trades', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: closingId, exitPrice: parseFloat(exitPrice) }),
      });
      setClosingId(null);
      setExitPrice('');
      fetchTrades();
    } catch (err) {
      console.error('[Journal] close trade error:', err);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this trade?')) return;
    try {
      await fetch(`/api/trades?id=${id}`, { method: 'DELETE' });
      fetchTrades();
    } catch (err) {
      console.error('[Journal] delete trade error:', err);
    }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Trade Journal</h1>
        {trades && (
          <span className="page-subtitle">
            {trades.openCount} open · {trades.closedCount} closed
            {trades.winRate != null && ` · ${trades.winRate}% win rate`}
            {trades.avgRMultiple != null && ` · ${trades.avgRMultiple}R avg`}
          </span>
        )}
      </div>

      {/* Stats strip */}
      {trades && trades.closedCount > 0 && (
        <div className="top-strip" style={{ marginBottom: 16 }}>
          <div className="top-strip-item">
            <span className="top-strip-label">Open Trades</span>
            <span className="top-strip-value">{trades.openCount}</span>
          </div>
          <div className="top-strip-item">
            <span className="top-strip-label">Closed</span>
            <span className="top-strip-value">{trades.closedCount}</span>
          </div>
          <div className="top-strip-item">
            <span className="top-strip-label">Win Rate</span>
            <span className={`top-strip-value ${(trades.winRate ?? 0) >= 50 ? 'text-bullish' : 'text-bearish'}`}>
              {trades.winRate != null ? `${trades.winRate}%` : '—'}
            </span>
          </div>
          <div className="top-strip-item">
            <span className="top-strip-label">Avg R</span>
            <span className={`top-strip-value ${(trades.avgRMultiple ?? 0) >= 0 ? 'text-bullish' : 'text-bearish'}`}>
              {trades.avgRMultiple != null ? `${trades.avgRMultiple}R` : '—'}
            </span>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Trade Entry Form */}
        <div className="card" id="trade-form">
          <div className="card-header">
            <h2>New Trade</h2>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>No thesis, no trade.</span>
          </div>
          <div className="card-body">
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="ticker">Ticker</label>
                  <input
                    id="ticker"
                    className="form-input"
                    value={ticker}
                    onChange={e => setTicker(e.target.value.toUpperCase())}
                    placeholder="RELIANCE"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="direction">Direction</label>
                  <select
                    id="direction"
                    className="form-input"
                    value={direction}
                    onChange={e => setDirection(e.target.value as 'long' | 'short')}
                  >
                    <option value="long">Long</option>
                    <option value="short">Short</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="entry">Entry ₹</label>
                  <input
                    id="entry"
                    className="form-input"
                    type="number"
                    step="0.05"
                    value={entry}
                    onChange={e => setEntry(e.target.value)}
                    placeholder="2500"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="stop">Stop ₹</label>
                  <input
                    id="stop"
                    className="form-input"
                    type="number"
                    step="0.05"
                    value={stop}
                    onChange={e => setStop(e.target.value)}
                    placeholder="2420"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="target">Target ₹</label>
                  <input
                    id="target"
                    className="form-input"
                    type="number"
                    step="0.05"
                    value={target}
                    onChange={e => setTarget(e.target.value)}
                    placeholder="2700"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="setup">Setup Name</label>
                <input
                  id="setup"
                  className="form-input"
                  value={setupName}
                  onChange={e => setSetupName(e.target.value)}
                  placeholder="setup-a@v1"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="thesis">
                  Thesis <span style={{ color: 'var(--bearish)', fontWeight: 400 }}>*required</span>
                </label>
                <textarea
                  id="thesis"
                  className="form-input"
                  value={thesis}
                  onChange={e => setThesis(e.target.value)}
                  placeholder="Why this trade? What's the catalyst? What invalidates the setup?"
                  required
                  rows={3}
                />
              </div>

              <button type="submit" className="btn btn-primary" disabled={!ticker || !entry || !stop || !thesis}>
                Log Trade ({computedQty} shares)
              </button>
            </form>
          </div>
        </div>

        {/* Position Size Calculator */}
        <div className="card" id="position-calculator">
          <div className="card-header">
            <h2>Position Sizer</h2>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="capital">Capital ₹</label>
                <input
                  id="capital"
                  className="form-input"
                  type="number"
                  value={capital}
                  onChange={e => setCapital(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="riskPct">Risk %</label>
                <input
                  id="riskPct"
                  className="form-input"
                  type="number"
                  step="0.25"
                  value={riskPct}
                  onChange={e => setRiskPct(e.target.value)}
                />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <span>Risk per share</span>
                <span style={{ fontWeight: 600 }}>₹{riskPerShare.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <span>Max risk amount</span>
                <span style={{ fontWeight: 600 }}>₹{riskAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <span>Position value</span>
                <span style={{ fontWeight: 600 }}>₹{positionValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
              {target && entryNum > 0 && stopNum > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <span>Reward : Risk</span>
                  <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
                    {(Math.abs((parseFloat(target) - entryNum)) / riskPerShare).toFixed(1)} : 1
                  </span>
                </div>
              )}
            </div>

            <div className="calc-output">
              <div>
                <div className="calc-output-label">Quantity</div>
                <div className="calc-output-value">{computedQty}</div>
              </div>
              <div style={{ flex: 1, textAlign: 'right' }}>
                <div className="calc-output-label">Shares</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  at {riskPctNum}% risk on ₹{Number(capital).toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            {/* Open trade cap warning */}
            {trades && trades.openCount >= 5 && (
              <div style={{
                background: 'var(--bearish-bg)',
                border: '1px solid rgba(251,113,133,0.2)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 14px',
                fontSize: '0.78rem',
                color: 'var(--bearish)',
              }}>
                ⚠️ You have {trades.openCount} open trades. Consider closing some before adding more.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Trade List */}
      <div className="card" style={{ marginTop: 16 }} id="trades-list">
        <div className="card-header">
          <h2>All Trades</h2>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="empty-state">
              <div className="pulse-dot" />
              <p style={{ marginTop: 12 }}>Loading trades…</p>
            </div>
          ) : !trades || trades.count === 0 ? (
            <div className="empty-state" style={{ padding: '40px 16px' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <p>No trades yet. Use the form above or click &quot;Journal it&quot; from the candidates table.</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Dir</th>
                    <th>Entry</th>
                    <th>Stop</th>
                    <th>Target</th>
                    <th>Qty</th>
                    <th>Setup</th>
                    <th>R</th>
                    <th>Status</th>
                    <th>Opened</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {trades.trades.map(t => (
                    <tr key={t.id}>
                      <td className="ticker-cell">{t.ticker}</td>
                      <td>
                        <span className={`badge ${t.direction === 'long' ? 'badge-bullish' : 'badge-bearish'}`}>
                          {t.direction}
                        </span>
                      </td>
                      <td>₹{t.entry.toFixed(2)}</td>
                      <td style={{ color: 'var(--bearish)' }}>₹{t.stop.toFixed(2)}</td>
                      <td>{t.target ? `₹${t.target.toFixed(2)}` : '—'}</td>
                      <td>{t.qty}</td>
                      <td>
                        {t.setupName ? (
                          <span className="badge badge-score">{t.setupName}</span>
                        ) : '—'}
                      </td>
                      <td>
                        {t.rMultiple != null ? (
                          <span
                            style={{
                              fontWeight: 700,
                              color: t.rMultiple >= 0 ? 'var(--bullish)' : 'var(--bearish)',
                            }}
                          >
                            {t.rMultiple >= 0 ? '+' : ''}{t.rMultiple}R
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        {t.closedAt ? (
                          <span className="badge badge-neutral">Closed</span>
                        ) : (
                          <span className="badge badge-bullish">Open</span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {new Date(t.openedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {!t.closedAt && (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => { setClosingId(t.id); setExitPrice(''); }}
                            >
                              Close
                            </button>
                          )}
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(t.id)}
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Close Trade Modal */}
      {closingId != null && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setClosingId(null)}
        >
          <div
            className="card"
            style={{ width: 360, padding: 24 }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 16 }}>
              Close Trade #{closingId}
            </h3>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label" htmlFor="exitPrice">Exit Price ₹</label>
              <input
                id="exitPrice"
                className="form-input"
                type="number"
                step="0.05"
                value={exitPrice}
                onChange={e => setExitPrice(e.target.value)}
                placeholder="2650"
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleClose} disabled={!exitPrice}>
                Close Trade
              </button>
              <button className="btn btn-ghost" onClick={() => setClosingId(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function JournalPage() {
  return (
    <Suspense fallback={
      <div className="empty-state" style={{ minHeight: '50vh' }}>
        <div className="pulse-dot" />
        <p style={{ marginTop: 12 }}>Loading journal…</p>
      </div>
    }>
      <JournalContent />
    </Suspense>
  );
}
