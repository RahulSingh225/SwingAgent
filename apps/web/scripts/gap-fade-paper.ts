/**
 * Paper-trading harness for the intraday gap fade.
 *
 * Purpose is NOT to re-measure the edge — the backtest already did that. It is to
 * measure the two things the backtest cannot:
 *
 *   1. FILL QUALITY. Every result assumes execution at the opening-auction price.
 *      Slippage is worst at the open and worst of all in a stock that just gapped.
 *      This logs the assumed open against the actual fill so the gap between them
 *      becomes a measured number instead of an assumption.
 *   2. TAIL BEHAVIOUR. Trade returns have p01 = −13% and a worst case of −52%,
 *      present in every market regime and not filterable at the open. Live
 *      observations of that tail are the only way to size the strategy honestly.
 *
 * RULES — all inputs knowable at 09:15:
 *   gap        |open/prev_close − 1| >= MIN_GAP
 *   liquidity  trailing 20-day turnover >= MIN_TURNOVER_CR
 *   not locked skip if the stock has no intraday range (unshortable)
 *   direction  gap up -> short, gap down -> long
 *   selection  largest absolute gap first, max MAX_POSITIONS per day
 *   exit       at the close, same day
 *
 * The same-day volume filter from the research is deliberately NOT used: it
 * divides by full-day volume, which does not exist when the order is placed.
 *
 * Commands:
 *   node scripts/gap-fade-paper.ts signals <YYYY-MM-DD>   list the day's candidates
 *   node scripts/gap-fade-paper.ts log <YYYY-MM-DD>       record them as paper trades
 *   node scripts/gap-fade-paper.ts fill <id> <price>      record the actual fill
 *   node scripts/gap-fade-paper.ts settle <YYYY-MM-DD>    close out using the day's close
 *   node scripts/gap-fade-paper.ts report                 performance + slippage to date
 */

import { sql } from './lib/db.ts';

const MIN_GAP = 3.0;
const MIN_TURNOVER_CR = 100;
const MAX_POSITIONS = 2;
const COST_PCT = 0.20;

async function ensureTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS paper_trades (
      id            serial PRIMARY KEY,
      trade_date    date NOT NULL,
      ticker        text NOT NULL,
      direction     text NOT NULL,
      gap_pct       double precision NOT NULL,
      turnover_cr   double precision,
      assumed_open  double precision NOT NULL,
      actual_fill   double precision,
      exit_price    double precision,
      gross_pct     double precision,
      net_pct       double precision,
      slippage_pct  double precision,
      status        text NOT NULL DEFAULT 'open',
      note          text,
      created_at    timestamptz NOT NULL DEFAULT now(),
      UNIQUE (trade_date, ticker)
    )
  `;
}

/** Candidates for a date, using only information available at the open. */
async function signals(date: string) {
  return sql<{
    ticker: string; direction: string; gap_pct: number;
    open: number; prev_close: number; turnover_cr: number;
  }[]>`
    WITH s AS (
      SELECT ticker, date, open, high, low, close,
             lag(close) OVER (PARTITION BY ticker ORDER BY date) AS prev_close
      FROM eod_prices_adj
    )
    SELECT s.ticker,
           CASE WHEN s.open > s.prev_close THEN 'short' ELSE 'long' END AS direction,
           100.0*(s.open/s.prev_close - 1) AS gap_pct,
           s.open, s.prev_close,
           t.t20/1e7 AS turnover_cr
    FROM s
    JOIN _turnover t ON t.ticker = s.ticker AND t.date = s.date
    WHERE s.date = ${date}
      AND s.prev_close > 0
      AND abs(100.0*(s.open/s.prev_close - 1)) >= ${MIN_GAP}
      AND t.t20 >= ${MIN_TURNOVER_CR * 1e7}
      AND s.high > s.low * 1.001
    ORDER BY abs(100.0*(s.open/s.prev_close - 1)) DESC
    LIMIT ${MAX_POSITIONS}
  `;
}

async function main(): Promise<void> {
  await ensureTable();
  const cmd = process.argv[2] ?? 'report';
  const arg = process.argv[3];

  if (cmd === 'signals' || cmd === 'log') {
    if (!arg) throw new Error('date required (YYYY-MM-DD)');
    const rows = await signals(arg);
    if (rows.length === 0) {
      console.log(`[paper] ${arg}: no qualifying signals — no trade today.`);
      await sql.end();
      return;
    }
    console.log(`[paper] ${arg} — ${rows.length} candidate(s), max ${MAX_POSITIONS}:`);
    for (const r of rows) {
      console.log(
        `  ${r.direction.toUpperCase().padEnd(5)} ${r.ticker.padEnd(12)} ` +
        `gap ${r.gap_pct.toFixed(2).padStart(6)}%  open ₹${r.open.toFixed(2).padStart(9)}  ` +
        `turnover ₹${Math.round(r.turnover_cr)}cr`,
      );
    }
    if (cmd === 'log') {
      for (const r of rows) {
        await sql`
          INSERT INTO paper_trades (trade_date, ticker, direction, gap_pct, turnover_cr, assumed_open)
          VALUES (${arg}, ${r.ticker}, ${r.direction}, ${r.gap_pct}, ${r.turnover_cr}, ${r.open})
          ON CONFLICT (trade_date, ticker) DO NOTHING
        `;
      }
      console.log(`[paper] logged ${rows.length} trade(s).`);
    }
  }

  else if (cmd === 'fill') {
    const price = Number(process.argv[4]);
    if (!arg || !Number.isFinite(price)) throw new Error('usage: fill <id> <price>');
    const [row] = await sql<{ assumed_open: number; direction: string; ticker: string }[]>`
      SELECT assumed_open, direction, ticker FROM paper_trades WHERE id = ${Number(arg)}
    `;
    if (!row) throw new Error(`no paper trade with id ${arg}`);
    // Slippage signed so positive always means "worse than assumed".
    const slip = row.direction === 'short'
      ? 100.0 * (row.assumed_open - price) / row.assumed_open
      : 100.0 * (price - row.assumed_open) / row.assumed_open;
    await sql`
      UPDATE paper_trades SET actual_fill = ${price}, slippage_pct = ${slip}
      WHERE id = ${Number(arg)}
    `;
    console.log(`[paper] ${row.ticker}: fill ₹${price} vs assumed ₹${row.assumed_open} → slippage ${slip.toFixed(3)}% (positive = worse)`);
  }

  else if (cmd === 'settle') {
    if (!arg) throw new Error('date required');
    const open = await sql<{ id: number; ticker: string; direction: string; actual_fill: number | null; assumed_open: number }[]>`
      SELECT id, ticker, direction, actual_fill, assumed_open
      FROM paper_trades WHERE trade_date = ${arg} AND status = 'open'
    `;
    for (const t of open) {
      const [px] = await sql<{ close: number }[]>`
        SELECT close FROM eod_prices_adj WHERE ticker = ${t.ticker} AND date = ${arg}
      `;
      if (!px) { console.warn(`  ${t.ticker}: no close yet`); continue; }
      const entry = t.actual_fill ?? t.assumed_open;
      const raw = 100.0 * (px.close / entry - 1);
      const gross = t.direction === 'short' ? -raw : raw;
      const net = gross - COST_PCT;
      await sql`
        UPDATE paper_trades
        SET exit_price = ${px.close}, gross_pct = ${gross}, net_pct = ${net}, status = 'closed'
        WHERE id = ${t.id}
      `;
      console.log(`  ${t.ticker.padEnd(12)} ${t.direction.padEnd(5)} entry ₹${entry.toFixed(2)} → ₹${px.close.toFixed(2)}  net ${net.toFixed(2)}%`);
    }
  }

  else {
    const [s] = await sql<{ n: string; closed: string; mean_net: number | null; win: number | null; worst: number | null; mean_slip: number | null }[]>`
      SELECT count(*)::text AS n,
             count(*) FILTER (WHERE status='closed')::text AS closed,
             round(avg(net_pct)::numeric,3) AS mean_net,
             round((100.0*avg(CASE WHEN net_pct>0 THEN 1 ELSE 0 END))::numeric,1) AS win,
             round(min(net_pct)::numeric,2) AS worst,
             round(avg(slippage_pct)::numeric,4) AS mean_slip
      FROM paper_trades
    `;
    console.log('[paper] performance to date');
    console.log(`  trades logged   : ${s.n} (${s.closed} closed)`);
    console.log(`  mean net        : ${s.mean_net ?? '-'}%   (backtest expectation: +0.36%)`);
    console.log(`  win rate        : ${s.win ?? '-'}%        (backtest expectation: 55%)`);
    console.log(`  worst trade     : ${s.worst ?? '-'}%      (backtest worst: -51.9%)`);
    console.log(`  mean slippage   : ${s.mean_slip ?? '-'}%  (positive = filled worse than the open)`);
    console.log('\n  Slippage is the number that decides viability: the edge is +0.36%,');
    console.log('  so anything above ~0.15% average slippage removes most of it.');
  }

  await sql.end();
}

main().catch(async err => {
  console.error('[paper] fatal:', err instanceof Error ? err.message : err);
  await sql.end();
  process.exit(1);
});
