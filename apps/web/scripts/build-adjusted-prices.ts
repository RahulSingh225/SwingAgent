/**
 * Build `eod_prices_adj` — the split/bonus-adjusted price series.
 *
 * Every bar is scaled by the product of the adjustment factors of all corporate
 * actions taking effect AFTER that bar, which restates history on today's share
 * basis and makes multi-day returns continuous across splits.
 *
 * Keyed on `effective_date` (from detect-split-dates.ts), not NSE's stated
 * `ex_date`: the price series re-bases one session after the stated ex-date in
 * 470 of 476 observed cases, and using the stated date injects a fake ±900%
 * bar. Actions with no `effective_date` never moved the quoted price and are
 * skipped by the join.
 *
 * Without this a 1:1 bonus reads as a 50% overnight loss, and since bonuses
 * cluster after good news, an unadjusted ledger would conclude that good news
 * predicts crashes.
 *
 * Volume is deliberately left raw: turnover (raw price × raw volume) is the
 * quantity the liquidity filter cares about, and adjusting both sides twice
 * would distort it.
 *
 * Usage: node scripts/build-adjusted-prices.ts
 */

import { sql } from './lib/db.ts';

async function build(): Promise<void> {
  console.log('[adjust] rebuilding eod_prices_adj …');

  await sql`DROP MATERIALIZED VIEW IF EXISTS eod_prices_adj`;

  await sql`
    CREATE MATERIALIZED VIEW eod_prices_adj AS
    SELECT
      p.ticker,
      p.date,
      p.open  * f.cum AS open,
      p.high  * f.cum AS high,
      p.low   * f.cum AS low,
      p.close * f.cum AS close,
      p.close           AS close_raw,
      p.volume,
      p.delivery_pct,
      f.cum             AS adj_factor
    FROM eod_prices p
    CROSS JOIN LATERAL (
      SELECT COALESCE(exp(sum(ln(a.adj_factor))), 1) AS cum
      FROM corporate_actions a
      WHERE a.ticker = p.ticker
        AND a.effective_date IS NOT NULL
        AND a.effective_date > p.date
        AND a.adj_factor IS NOT NULL
        AND a.adj_factor > 0
    ) f
  `;

  await sql`CREATE UNIQUE INDEX eod_prices_adj_pk ON eod_prices_adj (ticker, date)`;
  await sql`CREATE INDEX eod_prices_adj_date_idx ON eod_prices_adj (date)`;

  const [{ count }] = await sql<{ count: string }[]>`
    SELECT count(*) AS count FROM eod_prices_adj
  `;
  const [{ adjusted }] = await sql<{ adjusted: string }[]>`
    SELECT count(*) AS adjusted FROM eod_prices_adj WHERE adj_factor <> 1
  `;
  console.log(`[adjust] ${count} bars, ${adjusted} carry a non-trivial adjustment`);
}

/**
 * Verify the adjustment by checking that known splits no longer produce a
 * discontinuity. A 10→1 split should leave a ~-90% raw gap and a ~0% adjusted
 * one; anything else means the factors are being applied wrongly.
 */
async function verify(): Promise<boolean> {
  const checks = await sql<{
    ticker: string; ex_date: string; adj_factor: number;
    raw_gap_pct: number | null; adj_gap_pct: number | null;
  }[]>`
    WITH acts AS (
      SELECT ticker, effective_date AS ex_date, adj_factor
      FROM corporate_actions
      WHERE adj_factor IS NOT NULL AND adj_factor <> 1
        AND effective_date IS NOT NULL
    ),
    bars AS (
      SELECT
        a.ticker, a.ex_date, a.adj_factor,
        (SELECT close_raw FROM eod_prices_adj p
          WHERE p.ticker = a.ticker AND p.date < a.ex_date
          ORDER BY p.date DESC LIMIT 1) AS raw_before,
        (SELECT close_raw FROM eod_prices_adj p
          WHERE p.ticker = a.ticker AND p.date >= a.ex_date
          ORDER BY p.date ASC LIMIT 1) AS raw_after,
        (SELECT close FROM eod_prices_adj p
          WHERE p.ticker = a.ticker AND p.date < a.ex_date
          ORDER BY p.date DESC LIMIT 1) AS adj_before,
        (SELECT close FROM eod_prices_adj p
          WHERE p.ticker = a.ticker AND p.date >= a.ex_date
          ORDER BY p.date ASC LIMIT 1) AS adj_after
      FROM acts a
    )
    SELECT ticker, ex_date::text AS ex_date, adj_factor,
           round((100.0 * (raw_after - raw_before) / NULLIF(raw_before,0))::numeric, 1) AS raw_gap_pct,
           round((100.0 * (adj_after - adj_before) / NULLIF(adj_before,0))::numeric, 1) AS adj_gap_pct
    FROM bars
    WHERE raw_before IS NOT NULL AND raw_after IS NOT NULL
    ORDER BY abs(1 - adj_factor) DESC
    LIMIT 15
  `;

  if (checks.length === 0) {
    console.log('\n[verify] no overlapping price history for any adjustment yet — rerun after the price backfill.');
    return true;
  }

  console.log('\n[verify] gap across ex-date (raw should be large, adjusted near zero)');
  console.log('  ticker        ex_date     factor    raw_gap%   adj_gap%');
  let suspicious = 0;
  for (const c of checks) {
    const adjGap = Number(c.adj_gap_pct ?? 0);
    // A real move can be a few percent; a leftover split artifact is tens.
    const bad = Math.abs(adjGap) > 25;
    if (bad) suspicious++;
    console.log(
      `  ${c.ticker.padEnd(13)} ${c.ex_date}  ${String(c.adj_factor).slice(0, 6).padEnd(8)} ` +
      `${String(c.raw_gap_pct).padStart(8)}  ${String(c.adj_gap_pct).padStart(9)}${bad ? '  <-- CHECK' : ''}`,
    );
  }
  console.log(
    suspicious === 0
      ? '\n[verify] PASS — no residual split artifacts.'
      : `\n[verify] ${suspicious} adjustment(s) still show a large gap; inspect before trusting the ledger.`,
  );
  return suspicious === 0;
}

build()
  .then(verify)
  .then(async ok => {
    await sql.end();
    process.exit(ok ? 0 : 1);
  })
  .catch(async err => {
    console.error('[adjust] fatal:', err);
    await sql.end();
    process.exit(1);
  });
