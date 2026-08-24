/**
 * Capacity-constrained portfolio simulation for the intraday gap fade.
 *
 * Every previous number in gap-fade-findings.md is a PER-SIGNAL average, which
 * silently assumes you take every signal. The trader takes at most 2 per day, so
 * the realised result depends on which 2 — and on how often no signal appears at
 * all. This converts "+0.36% per trade" into "what the account would have done".
 *
 * EXECUTABLE RULES ONLY. Everything here is knowable at 09:15:
 *   - gap        = open vs previous close        (known at the open)
 *   - turnover   = trailing 20-day average       (known)
 *   - prior-day volume ratio                     (known)
 * The same-day volume filter from the research is deliberately EXCLUDED: it
 * divides by full-day volume, which does not exist when the order is placed.
 * Using it would be look-ahead bias.
 *
 * Selection when more than 2 candidates qualify: largest absolute gap first.
 * Non-discretionary, and it follows the monotonic gap gradient.
 *
 * Usage: node scripts/simulate-gap-fade-portfolio.ts [minGap] [minTurnoverCr] [maxPos]
 */

import { sql } from './lib/db.ts';

const COST_PCT = 0.20;

interface Row {
  date: string; ticker: string; gap_pct: number; excess_oc: number;
  t20: number; direction: string;
}

async function run(): Promise<void> {
  const minGap = Number(process.argv[2] ?? 3);
  const minTurnoverCr = Number(process.argv[3] ?? 100);
  const maxPos = Number(process.argv[4] ?? 2);
  const minTurnover = minTurnoverCr * 1e7;

  console.log(
    `[sim] gap >= ${minGap}%, turnover >= ₹${minTurnoverCr}cr, max ${maxPos} positions/day, ` +
    `cost ${COST_PCT}% round-trip`,
  );

  const rows = await sql<Row[]>`
    SELECT g.date::text AS date, g.ticker, g.gap_pct, g.excess_oc, g.t20,
           CASE WHEN g.gap_pct > 0 THEN 'short' ELSE 'long' END AS direction
    FROM gap_intraday g
    JOIN eod_prices_adj p ON p.ticker = g.ticker AND p.date = g.date
    WHERE abs(g.gap_pct) >= ${minGap}
      AND g.t20 >= ${minTurnover}
      AND p.high > p.low * 1.001          -- skip circuit-locked days: unshortable
    ORDER BY g.date, abs(g.gap_pct) DESC
  `;

  // Group by day, take the top N by absolute gap.
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = byDay.get(r.date) ?? [];
    if (arr.length < maxPos) arr.push(r);
    byDay.set(r.date, arr);
  }

  const days = [...byDay.keys()].sort();
  let equity = 100;
  const dailyPct: Array<{ date: string; pct: number; n: number }> = [];
  let wins = 0, trades = 0;
  let peak = 100, maxDD = 0;

  for (const d of days) {
    const picks = byDay.get(d)!;
    // Equal weight across the day's picks; full capital deployed only when
    // maxPos trades are available.
    let dayPct = 0;
    for (const p of picks) {
      const signed = p.direction === 'short' ? -p.excess_oc : p.excess_oc;
      const net = signed - COST_PCT;
      dayPct += net / maxPos;
      trades++;
      if (net > 0) wins++;
    }
    equity *= 1 + dayPct / 100;
    dailyPct.push({ date: d, pct: dayPct, n: picks.length });
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }

  const first = days[0], last = days[days.length - 1];
  const years = (new Date(last).getTime() - new Date(first).getTime()) / (365.25 * 864e5);
  const cagr = (Math.pow(equity / 100, 1 / years) - 1) * 100;

  const daySd = Math.sqrt(
    dailyPct.reduce((a, r) => a + Math.pow(r.pct - dailyPct.reduce((s, x) => s + x.pct, 0) / dailyPct.length, 2), 0) /
    dailyPct.length,
  );
  const meanDay = dailyPct.reduce((s, x) => s + x.pct, 0) / dailyPct.length;
  const sharpe = (meanDay / daySd) * Math.sqrt(252);

  console.log(`\n[sim] ${first} → ${last}  (${years.toFixed(1)} years)`);
  console.log(`  trading days with >=1 signal : ${days.length}`);
  console.log(`  total trades                 : ${trades}`);
  console.log(`  trade win rate               : ${(100 * wins / trades).toFixed(1)}%`);
  console.log(`  mean day (when trading)      : ${meanDay.toFixed(3)}%`);
  console.log(`  equity 100 →                 : ${equity.toFixed(1)}`);
  console.log(`  CAGR (on days traded)        : ${cagr.toFixed(1)}%`);
  console.log(`  max drawdown                 : ${maxDD.toFixed(1)}%`);
  console.log(`  approx Sharpe                : ${sharpe.toFixed(2)}`);

  // Yearly breakdown — where does it actually make or lose money?
  const byYear = new Map<string, { pct: number; n: number; days: number }>();
  for (const r of dailyPct) {
    const y = r.date.slice(0, 4);
    const cur = byYear.get(y) ?? { pct: 0, n: 0, days: 0 };
    cur.pct += r.pct; cur.n += r.n; cur.days++;
    byYear.set(y, cur);
  }
  console.log('\n  year   days  trades   sum%');
  for (const [y, v] of [...byYear].sort()) {
    console.log(`  ${y}   ${String(v.days).padStart(4)}  ${String(v.n).padStart(6)}  ${v.pct.toFixed(1).padStart(7)}`);
  }

  // Worst days — the tail that matters for a 2-position book.
  const worst = [...dailyPct].sort((a, b) => a.pct - b.pct).slice(0, 5);
  console.log('\n  worst days:');
  for (const w of worst) console.log(`    ${w.date}  ${w.pct.toFixed(2)}%  (${w.n} trades)`);

  await sql.end();
}

run().catch(async err => {
  console.error('[sim] fatal:', err);
  await sql.end();
  process.exit(1);
});
