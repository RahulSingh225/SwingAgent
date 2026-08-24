/**
 * Intraday gap-fade study — enter at the open, square off at the close.
 *
 * Viable now that the trader can be present around the open. This is the part of
 * the Priority-1 brief that daily bars CAN answer: gap size, and the full
 * open-to-close move. Opening-range breakout and first-30/60/90-minute behaviour
 * need intraday bars and are out of scope until such data exists.
 *
 * THE BASELINE THAT DOMINATES THIS STUDY
 * Individual liquid stocks fall an average 0.19% from open to close, which is
 * 0.148% worse than NIFTY over the same hours; only 42.7% beat the index
 * intraday. So shorting a random stock at the open and covering at the close
 * earns +0.148% excess for free, with no signal at all. A gap-fade short must be
 * measured against THAT, not against zero, or the drift gets miscredited to the
 * strategy. Every table below reports the edge over this no-signal baseline.
 *
 * Costs are lower intraday than for delivery (STT applies to the sell side only
 * at a reduced rate), so 0.20% round-trip is used rather than the 0.35% delivery
 * assumption, and sensitivity is reported.
 *
 * Usage: node scripts/test-gap-fade-intraday.ts
 */

import { sql } from './lib/db.ts';

const COST_INTRADAY = 0.20;
const MIN_TURNOVER = 50_000_000; // ₹5 Cr

async function build(): Promise<void> {
  console.log('[gapfade] building intraday panel …');
  await sql`DROP TABLE IF EXISTS gap_intraday`;
  await sql.unsafe(`
    CREATE TABLE gap_intraday AS
    WITH s AS (
      SELECT ticker, date, open, high, low, close, volume,
             lag(close) OVER (PARTITION BY ticker ORDER BY date) AS prev_close,
             row_number() OVER (PARTITION BY ticker ORDER BY date) AS sn
      FROM eod_prices_adj
    )
    SELECT
      s.ticker, s.date, s.open, s.close, s.prev_close,
      100.0*(s.open/s.prev_close - 1)          AS gap_pct,
      100.0*(s.close/s.open - 1)               AS stock_oc,
      100.0*(n.close/n.open - 1)               AS nifty_oc,
      100.0*(s.close/s.open - 1) - 100.0*(n.close/n.open - 1) AS excess_oc,
      v.volume / NULLIF(v.avgvol20, 0)         AS vol_ratio,
      t.t20
    FROM s
    JOIN _nifty n ON n.date = s.date
    JOIN _turnover t ON t.ticker = s.ticker AND t.date = s.date AND t.t20 >= ${MIN_TURNOVER}
    LEFT JOIN _volratio v ON v.ticker = s.ticker AND v.date = s.date
    WHERE s.open > 0 AND s.prev_close > 0 AND n.open > 0
  `);
  await sql`CREATE INDEX gap_intraday_idx ON gap_intraday (date, gap_pct)`;
  await sql`ANALYZE gap_intraday`;
  const [{ n }] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM gap_intraday`;
  console.log(`[gapfade] ${n} liquid stock-days`);
}

async function report(): Promise<void> {
  // Baseline: the signal-free short. Everything else is judged against this.
  const [base] = await sql<{ mean_excess: number; n: string }[]>`
    SELECT count(*)::text AS n, round(avg(-excess_oc)::numeric,4) AS mean_excess
    FROM gap_intraday
  `;
  console.log(`\nBASELINE — short any liquid stock at open, cover at close:`);
  console.log(`  n=${base.n}  gross excess = ${base.mean_excess}%  (before ${COST_INTRADAY}% cost)`);

  console.log('\n=== FADE AN UP-GAP (short at open, cover at close) ===');
  console.table(await sql`
    SELECT CASE WHEN gap_pct >= 10 THEN 'f: 10%+'
                WHEN gap_pct >= 7  THEN 'e: 7-10%'
                WHEN gap_pct >= 5  THEN 'd: 5-7%'
                WHEN gap_pct >= 3  THEN 'c: 3-5%'
                WHEN gap_pct >= 2  THEN 'b: 2-3%'
                ELSE 'a: 1-2%' END AS gap_bucket,
      count(*)::text AS n,
      round(avg(-excess_oc)::numeric,3) AS gross_excess,
      round((avg(-excess_oc) - ${COST_INTRADAY})::numeric,3) AS net_excess,
      round((avg(-excess_oc) - 0.1479)::numeric,3) AS edge_over_baseline,
      round((100.0*avg(CASE WHEN -excess_oc > 0 THEN 1 ELSE 0 END))::numeric,1) AS win_pct
    FROM gap_intraday WHERE gap_pct >= 1
    GROUP BY 1 ORDER BY 1
  `);

  console.log('\n=== FADE A DOWN-GAP (long at open, sell at close) ===');
  console.table(await sql`
    SELECT CASE WHEN gap_pct <= -10 THEN 'f: -10%+'
                WHEN gap_pct <= -7  THEN 'e: -7 to -10%'
                WHEN gap_pct <= -5  THEN 'd: -5 to -7%'
                WHEN gap_pct <= -3  THEN 'c: -3 to -5%'
                WHEN gap_pct <= -2  THEN 'b: -2 to -3%'
                ELSE 'a: -1 to -2%' END AS gap_bucket,
      count(*)::text AS n,
      round(avg(excess_oc)::numeric,3) AS gross_excess,
      round((avg(excess_oc) - ${COST_INTRADAY})::numeric,3) AS net_excess,
      round((avg(excess_oc) + 0.1479)::numeric,3) AS edge_over_baseline,
      round((100.0*avg(CASE WHEN excess_oc > 0 THEN 1 ELSE 0 END))::numeric,1) AS win_pct
    FROM gap_intraday WHERE gap_pct <= -1
    GROUP BY 1 ORDER BY 1
  `);

  console.log('\n=== UP-GAP FADE, OUT-OF-SAMPLE (gap >= 5%) ===');
  console.table(await sql`
    SELECT CASE WHEN date < '2024-01-01' THEN 'TRAIN 2019-23' ELSE 'TEST 2024-26' END AS period,
      count(*)::text AS n,
      round(avg(-excess_oc)::numeric,3) AS gross_excess,
      round((avg(-excess_oc) - ${COST_INTRADAY})::numeric,3) AS net_excess,
      round((avg(-excess_oc) - 0.1479)::numeric,3) AS edge_over_baseline,
      round((100.0*avg(CASE WHEN -excess_oc > 0 THEN 1 ELSE 0 END))::numeric,1) AS win_pct
    FROM gap_intraday WHERE gap_pct >= 5
    GROUP BY 1 ORDER BY 1 DESC
  `);

  console.log('\n=== UP-GAP + VOLUME CLIMAX (the Priority-2 re-test, intraday) ===');
  console.table(await sql`
    SELECT CASE WHEN vol_ratio >= 4 THEN 'vol 4x+'
                WHEN vol_ratio >= 2 THEN 'vol 2-4x'
                ELSE 'vol <2x' END AS vol_bucket,
      count(*)::text AS n,
      round(avg(-excess_oc)::numeric,3) AS gross_excess,
      round((avg(-excess_oc) - ${COST_INTRADAY})::numeric,3) AS net_excess,
      round((avg(-excess_oc) - 0.1479)::numeric,3) AS edge_over_baseline,
      round((100.0*avg(CASE WHEN -excess_oc > 0 THEN 1 ELSE 0 END))::numeric,1) AS win_pct
    FROM gap_intraday WHERE gap_pct >= 3 AND vol_ratio IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `);
}

build()
  .then(report)
  .then(async () => { await sql.end(); })
  .catch(async err => {
    console.error('[gapfade] fatal:', err);
    await sql.end();
    process.exit(1);
  });
