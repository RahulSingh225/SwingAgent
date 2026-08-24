/**
 * Wave-fade study — price every wave-exhaustion signal and report both variants.
 *
 * Hypothesis: after >= 3 consecutive directional sessions, a small-bodied
 * exhaustion candle marks momentum failure, and fading it at the next open pays.
 *
 * Entry is the NEXT session's OPEN, as specified. Both legs are now measured
 * open-to-close — index opens were backfilled for this study, so unlike the
 * catalyst ledger there is no overnight-gap mismatch between the stock leg and
 * the benchmark leg.
 *
 * Direction: a short after an up-wave profits when the stock UNDERPERFORMS the
 * index, so the relative return is signed before costs are charged.
 *
 * The exhaustion threshold is swept rather than fixed — the handover spec was
 * truncated before stating it, and a sweep also exposes whether any edge is a
 * genuine gradient or a single lucky cut.
 *
 * Usage: node scripts/test-wave-fade.ts
 */

import { sql } from './lib/db.ts';

const COST_PCT = 0.35;
const MIN_TURNOVER = 50_000_000; // ₹5 Cr, same floor as the catalyst ledger
const HORIZONS = [1, 3, 5, 10] as const;
const BODY_THRESHOLDS = [0.15, 0.20, 0.25, 0.30, 0.40, 0.50];
/** Variant B: the wave's first session gapped this far in the wave's direction. */
const GAP_THRESHOLD = 4.0;

async function rebuildSessions(): Promise<void> {
  // _sessions previously carried no `open`; the fade enters at the open.
  await sql`DROP TABLE IF EXISTS _sessions_o`;
  await sql`
    CREATE TABLE _sessions_o AS
    SELECT ticker, date, open, high, low, close, close_raw, volume,
           row_number() OVER (PARTITION BY ticker ORDER BY date) AS sn
    FROM eod_prices_adj
  `;
  await sql`CREATE UNIQUE INDEX _sessions_o_pk ON _sessions_o (ticker, sn)`;
  await sql`CREATE UNIQUE INDEX _sessions_o_td ON _sessions_o (ticker, date)`;
  await sql`ANALYZE _sessions_o`;
}

async function priceSignals(): Promise<void> {
  console.log('[fade] pricing signals …');

  const sel = HORIZONS.map(h => `
      (CASE WHEN w.direction = 'long' THEN 1 ELSE -1 END *
        (100.0*(s${h}.close/e.open - 1) - 100.0*(n${h}.close/ne.open - 1))
      ) - ${COST_PCT} AS exc_${h}`).join(',');

  const joins = HORIZONS.map(h => `
    LEFT JOIN _sessions_o s${h} ON s${h}.ticker = w.ticker AND s${h}.sn = e.sn + ${h}
    LEFT JOIN _nifty      n${h} ON n${h}.sn = ne.sn + ${h}`).join('');

  await sql`DROP TABLE IF EXISTS fade_outcomes`;
  await sql.unsafe(`
    CREATE TABLE fade_outcomes AS
    SELECT
      w.ticker, w.signal_date, w.direction, w.wave_dir, w.wave_len,
      w.wave_move_pct, w.body_ratio, w.range_pct, w.start_gap_pct,
      e.date AS entry_date, e.open AS entry_open,
      ${sel}
    FROM wave_signals w
    JOIN _sessions_o sig ON sig.ticker = w.ticker AND sig.date = w.signal_date
    JOIN _sessions_o e   ON e.ticker = w.ticker AND e.sn = sig.sn + 1
    JOIN _nifty ne       ON ne.date = e.date
    JOIN _turnover tv    ON tv.ticker = w.ticker AND tv.date = e.date AND tv.t20 >= ${MIN_TURNOVER}
    ${joins}
    WHERE e.open > 0 AND ne.open > 0
  `);
  await sql`CREATE INDEX fade_out_idx ON fade_outcomes (entry_date, body_ratio)`;
  await sql`ANALYZE fade_outcomes`;

  const [{ n }] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM fade_outcomes WHERE exc_5 IS NOT NULL
  `;
  console.log(`[fade] ${n} priced fade signals`);
}

/** Baseline: same entry mechanics on random liquid stock-days, both directions. */
async function buildControl(): Promise<void> {
  await sql`DROP TABLE IF EXISTS fade_control`;
  await sql.unsafe(`
    CREATE TABLE fade_control AS
    WITH picks AS (
      SELECT p.ticker, p.date, p.sn
      FROM _sessions_o p
      JOIN _turnover tv ON tv.ticker = p.ticker AND tv.date = p.date AND tv.t20 >= ${MIN_TURNOVER}
      WHERE random() < 0.01
    )
    SELECT k.ticker, k.date AS entry_date, d.direction,
      (CASE WHEN d.direction='long' THEN 1 ELSE -1 END *
        (100.0*(s5.close/e.open - 1) - 100.0*(n5.close/ne.open - 1))) - ${COST_PCT} AS exc_5
    FROM picks k
    CROSS JOIN (VALUES ('long'),('short')) AS d(direction)
    JOIN _sessions_o e ON e.ticker = k.ticker AND e.sn = k.sn + 1
    JOIN _nifty ne ON ne.date = e.date
    LEFT JOIN _sessions_o s5 ON s5.ticker = k.ticker AND s5.sn = e.sn + 5
    LEFT JOIN _nifty n5 ON n5.sn = ne.sn + 5
    WHERE e.open > 0 AND ne.open > 0
  `);
  await sql`ANALYZE fade_control`;
}

async function report(): Promise<void> {
  console.log('\n=== CONTROL: random liquid stock-days, same mechanics ===');
  console.table(await sql`
    SELECT direction, count(*)::text AS n,
      round(avg(exc_5)::numeric,3) AS mean_t5,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY exc_5)::numeric,3) AS med_t5,
      round((100.0*avg(CASE WHEN exc_5>0 THEN 1 ELSE 0 END))::numeric,1) AS win_t5
    FROM fade_control WHERE exc_5 IS NOT NULL GROUP BY 1 ORDER BY 1
  `);

  for (const th of (process.env.SKIP_SWEEP ? [] : BODY_THRESHOLDS)) {
    const rows = await sql`
      SELECT wave_dir, count(*)::text AS n,
        round(avg(exc_5)::numeric,3)  AS mean_t5,
        round(percentile_cont(0.5) WITHIN GROUP (ORDER BY exc_5)::numeric,3) AS med_t5,
        round((100.0*avg(CASE WHEN exc_5>0 THEN 1 ELSE 0 END))::numeric,1) AS win_t5,
        round(avg(exc_10)::numeric,3) AS mean_t10
      FROM fade_outcomes
      WHERE exc_5 IS NOT NULL AND body_ratio < ${th}
      GROUP BY 1 ORDER BY 1
    `;
    console.log(`\n=== VARIANT A — body_ratio < ${th} ===`);
    console.table(rows);
  }

  console.log('\n=== VARIANT B — wave opened with a >=4% gap in its direction ===');
  console.table(await sql`
    SELECT wave_dir, count(*)::text AS n,
      round(avg(exc_5)::numeric,3) AS mean_t5,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY exc_5)::numeric,3) AS med_t5,
      round((100.0*avg(CASE WHEN exc_5>0 THEN 1 ELSE 0 END))::numeric,1) AS win_t5,
      round(avg(exc_10)::numeric,3) AS mean_t10
    FROM fade_outcomes
    WHERE exc_5 IS NOT NULL AND body_ratio < 0.30
      AND ((wave_dir='up'   AND start_gap_pct >= ${GAP_THRESHOLD}::double precision)
        OR (wave_dir='down' AND start_gap_pct <= ${-GAP_THRESHOLD}::double precision))
    GROUP BY 1 ORDER BY 1
  `);

  console.log('\n=== OUT-OF-SAMPLE (body_ratio < 0.30, all signals) ===');
  console.table(await sql`
    SELECT CASE WHEN entry_date < '2024-01-01' THEN 'TRAIN 2019-23' ELSE 'TEST 2024-26' END AS period,
      wave_dir, count(*)::text AS n,
      round(avg(exc_5)::numeric,3) AS mean_t5,
      round((100.0*avg(CASE WHEN exc_5>0 THEN 1 ELSE 0 END))::numeric,1) AS win_t5
    FROM fade_outcomes WHERE exc_5 IS NOT NULL AND body_ratio < 0.30
    GROUP BY 1,2 ORDER BY 1 DESC, 2
  `);
}

(process.env.REUSE ? Promise.resolve() : rebuildSessions().then(priceSignals).then(buildControl))
  .then(report)
  .then(async () => { await sql.end(); })
  .catch(async err => {
    console.error('[fade] fatal:', err);
    await sql.end();
    process.exit(1);
  });
