/**
 * Stop-loss test for the intraday gap fade — the question all the intraday data
 * was acquired to answer.
 *
 * THE PROBLEM (from gap-fade-findings.md)
 * The gap fade has mean +0.36% and a worst trade of −51.9%, with p01 = −13%.
 * Surviving that tail on 1% capital risk caps position size near 2% of capital,
 * which reduces a +0.36% edge to roughly +2.5%/year — not worth the attention.
 * The strategy is only meaningful if a stop truncates the tail without eating
 * the edge. Daily bars cannot test that: they cannot say whether price touched
 * −5% before closing +1%.
 *
 * METHOD — deliberately hybrid, because each source is used only where it is good
 *   entry  : bhavcopy OPEN     (exact opening-auction print)
 *   exit   : bhavcopy CLOSE    (exact) when the stop is not hit
 *   path   : yfinance 60m HIGH/LOW, validated to ~0.03% against bhavcopy
 * Yahoo's own open/close are NOT used anywhere — they carry 0.1-0.4% error,
 * which would be a third of the edge.
 *
 * A short (gap-up fade) is stopped when an hourly HIGH reaches entry×(1+stop);
 * a long (gap-down fade) when an hourly LOW reaches entry×(1−stop).
 *
 * STOP FILLS ARE PENALISED. A stop in a fast market does not fill at its trigger.
 * Fills are assumed STOP_SLIPPAGE_PCT worse than the trigger, and the result is
 * reported across several values — because in exactly the runaway moves this is
 * meant to protect against, slippage is worst.
 *
 * KNOWN LIMITATION: hourly bars give 6-7 points per session, so intra-hour
 * sequence is invisible. If both the stop level and a favourable move occur
 * inside one bar, this assumes the STOP hit first — the conservative choice.
 *
 * Usage: node scripts/test-gap-fade-stops.ts [minGap] [minTurnoverCr]
 */

import { sql } from './lib/db.ts';

const COST_PCT = 0.20;
const STOP_LEVELS = [2, 3, 5, 7, 10];
const SLIPPAGE_LEVELS = [0, 0.3, 0.6];

interface Signal {
  ticker: string; date: string; direction: string;
  entry: number; exit_close: number; gap_pct: number;
}
interface Bar { ticker: string; d: string; high: number; low: number; seq: number }

async function run(): Promise<void> {
  const minGap = Number(process.argv[2] ?? 3);
  const minTurnoverCr = Number(process.argv[3] ?? 100);

  // Signals: exact prices from bhavcopy, restricted to days we have hourly path for.
  const signals = await sql<Signal[]>`
    WITH s AS (
      SELECT ticker, date, open, close, high, low,
             lag(close) OVER (PARTITION BY ticker ORDER BY date) AS prev_close
      FROM eod_prices_adj
    )
    SELECT s.ticker, s.date::text AS date,
           CASE WHEN s.open > s.prev_close THEN 'short' ELSE 'long' END AS direction,
           s.open AS entry, s.close AS exit_close,
           100.0*(s.open/s.prev_close - 1) AS gap_pct
    FROM s
    JOIN _turnover t ON t.ticker = s.ticker AND t.date = s.date AND t.t20 >= ${minTurnoverCr * 1e7}
    WHERE s.prev_close > 0 AND s.open > 0
      AND abs(100.0*(s.open/s.prev_close - 1)) >= ${minGap}
      AND s.high > s.low * 1.001
      AND EXISTS (SELECT 1 FROM intraday_bars b
                  WHERE b.ticker = s.ticker AND b.interval='60m'
                    AND (b.ts AT TIME ZONE 'Asia/Kolkata')::date = s.date)
    ORDER BY s.date
  `;
  console.log(`[stops] ${signals.length} signals with hourly path coverage`);
  if (signals.length === 0) { await sql.end(); return; }

  // Hourly path for exactly those (ticker, date) pairs.
  const bars = await sql<Bar[]>`
    SELECT b.ticker,
           (b.ts AT TIME ZONE 'Asia/Kolkata')::date::text AS d,
           b.high, b.low,
           row_number() OVER (PARTITION BY b.ticker, (b.ts AT TIME ZONE 'Asia/Kolkata')::date
                              ORDER BY b.ts) AS seq
    FROM intraday_bars b
    WHERE b.interval = '60m'
      AND (b.ts AT TIME ZONE 'Asia/Kolkata')::date >= ${signals[0].date}
  `;
  const path = new Map<string, Bar[]>();
  for (const b of bars) {
    const k = `${b.ticker}|${b.d}`;
    const arr = path.get(k) ?? [];
    arr.push(b);
    path.set(k, arr);
  }
  for (const arr of path.values()) arr.sort((a, b) => a.seq - b.seq);

  /** Net % for one signal under a given stop and slippage. null = no path data. */
  function evaluate(s: Signal, stopPct: number | null, slipPct: number): number | null {
    const p = path.get(`${s.ticker}|${s.date}`);
    if (!p || p.length === 0) return null;
    const isShort = s.direction === 'short';

    if (stopPct !== null) {
      const trigger = isShort ? s.entry * (1 + stopPct / 100) : s.entry * (1 - stopPct / 100);
      for (const bar of p) {
        const hit = isShort ? Number(bar.high) >= trigger : Number(bar.low) <= trigger;
        if (hit) {
          // Filled worse than the trigger by `slipPct`.
          const fill = isShort ? trigger * (1 + slipPct / 100) : trigger * (1 - slipPct / 100);
          const raw = 100.0 * (fill / s.entry - 1);
          return (isShort ? -raw : raw) - COST_PCT;
        }
      }
    }
    const raw = 100.0 * (s.exit_close / s.entry - 1);
    return (isShort ? -raw : raw) - COST_PCT;
  }

  function stats(vals: number[]) {
    const v = [...vals].sort((a, b) => a - b);
    const n = v.length;
    const mean = v.reduce((a, b) => a + b, 0) / n;
    const q = (p: number) => v[Math.min(n - 1, Math.max(0, Math.floor(p * n)))];
    return {
      n, mean,
      median: q(0.5), p01: q(0.01), p05: q(0.05),
      worst: v[0],
      win: (100 * v.filter(x => x > 0).length) / n,
    };
  }

  const baseline = signals.map(s => evaluate(s, null, 0)).filter((x): x is number => x !== null);
  const b = stats(baseline);
  console.log(
    `\nNO STOP (baseline on this subset)\n` +
    `  n=${b.n}  mean=${b.mean.toFixed(3)}%  median=${b.median.toFixed(2)}%  ` +
    `win=${b.win.toFixed(1)}%  p01=${b.p01.toFixed(2)}%  worst=${b.worst.toFixed(2)}%`,
  );

  for (const slip of SLIPPAGE_LEVELS) {
    console.log(`\n=== STOP SLIPPAGE ${slip}% ===`);
    console.log('  stop     n     mean    median    win%      p01     worst   stopped%');
    for (const stop of STOP_LEVELS) {
      const vals: number[] = [];
      let stopped = 0;
      for (const s of signals) {
        const withStop = evaluate(s, stop, slip);
        if (withStop === null) continue;
        const noStop = evaluate(s, null, 0)!;
        if (Math.abs(withStop - noStop) > 1e-9) stopped++;
        vals.push(withStop);
      }
      const t = stats(vals);
      console.log(
        `  ${String(stop).padStart(3)}%  ${String(t.n).padStart(5)}  ` +
        `${t.mean.toFixed(3).padStart(7)}  ${t.median.toFixed(2).padStart(7)}  ` +
        `${t.win.toFixed(1).padStart(6)}  ${t.p01.toFixed(2).padStart(8)}  ` +
        `${t.worst.toFixed(2).padStart(8)}  ${((100 * stopped) / t.n).toFixed(1).padStart(7)}`,
      );
    }
  }

  console.log(
    '\nRead this against the sizing constraint: the point of a stop is to shrink' +
    '\n`worst` and `p01` enough to raise position size, WITHOUT killing `mean`.',
  );
  await sql.end();
}

run().catch(async err => {
  console.error('[stops] fatal:', err);
  await sql.end();
  process.exit(1);
});
