/**
 * Test the last untested thesis: is a recent catalyst a useful FILTER on
 * technical screener candidates?
 *
 * Catalyst-as-trigger is already closed — the move is fully priced in the
 * opening auction (see docs/ledger-findings.md). This asks the weaker and more
 * plausible question: when the screener flags a setup anyway, does a recent
 * order announcement on that ticker change the odds?
 *
 * Method
 *   Universe   — replicates lib/screener/universe.ts: raw close > ₹200,
 *                volume > 100k, top 100 by ROC(20). Raw close is used for the
 *                price floor because that is the price a trader saw that day.
 *   Setups     — replicates dma-pullback, rsi-reaction, stoch-reaction and
 *                confluence, long and short, from lib/screener/setups/.
 *   Entry      — close of the session AFTER the signal, matching the event
 *                ledger so the two studies are directly comparable and no
 *                signal is acted on before it could have been seen.
 *   Returns    — split-adjusted, excess vs NIFTY 50, net of round-trip cost.
 *   Catalyst   — an order-type announcement on the same ticker within the
 *                preceding N sessions.
 *
 * Both arms share every convention, so entry timing cannot bias the comparison.
 *
 * Usage: node scripts/test-catalyst-filter.ts
 */

import { sql } from './lib/db.ts';

const COST_PCT = 0.35;
const CATALYST_LOOKBACK_SESSIONS = 10;

async function buildCandidates(): Promise<void> {
  console.log('[filter] generating historical candidates …');
  await sql`DROP TABLE IF EXISTS screener_candidates`;

  // Rank within each date, then keep the top 100 by ROC(20) — the universe rule.
  await sql`
    CREATE TABLE screener_candidates AS
    WITH ranked AS (
      SELECT h.*,
             row_number() OVER (PARTITION BY date ORDER BY roc20 DESC) AS rn
      FROM hist_indicators h
      WHERE close_raw > 200 AND volume > 100000 AND roc20 IS NOT NULL
    ),
    universe AS (SELECT * FROM ranked WHERE rn <= 100),
    hits AS (
      -- 20 DMA pullback
      SELECT ticker, date, 'dma-pullback' AS setup, 'long' AS direction FROM universe
      WHERE weekly_trend='UP' AND close_prev < sma20_prev AND close_raw IS NOT NULL
        AND sma20 IS NOT NULL AND close_prev IS NOT NULL
        AND (SELECT close FROM eod_prices_adj p WHERE p.ticker=universe.ticker AND p.date=universe.date) > sma20
      UNION ALL
      SELECT ticker, date, 'dma-pullback', 'short' FROM universe
      WHERE weekly_trend='DOWN' AND close_prev > sma20_prev
        AND (SELECT close FROM eod_prices_adj p WHERE p.ticker=universe.ticker AND p.date=universe.date) < sma20
      UNION ALL
      -- RSI(7) reaction
      SELECT ticker, date, 'rsi-reaction', 'long' FROM universe
      WHERE weekly_trend='UP' AND rsi7_prev < 40 AND rsi7 > rsi7_prev
      UNION ALL
      SELECT ticker, date, 'rsi-reaction', 'short' FROM universe
      WHERE weekly_trend='DOWN' AND rsi7_prev > 60 AND rsi7 < rsi7_prev
      UNION ALL
      -- Slow stochastic(7,10) reaction
      SELECT ticker, date, 'stoch-reaction', 'long' FROM universe
      WHERE weekly_trend='UP' AND stoch_k_prev < 20 AND stoch_k > stoch_k_prev
      UNION ALL
      SELECT ticker, date, 'stoch-reaction', 'short' FROM universe
      WHERE weekly_trend='DOWN' AND stoch_k_prev > 80 AND stoch_k < stoch_k_prev
    )
    SELECT DISTINCT ticker, date, setup, direction FROM hits
  `;
  await sql`CREATE INDEX sc_td_idx ON screener_candidates (ticker, date)`;
  await sql`ANALYZE screener_candidates`;

  const [{ n }] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM screener_candidates`;
  console.log(`[filter] ${n} raw candidate signals`);
}

async function priceCandidates(): Promise<void> {
  console.log('[filter] pricing candidates …');
  await sql`DROP TABLE IF EXISTS candidate_outcomes`;
  await sql`
    CREATE TABLE candidate_outcomes AS
    WITH sig AS (
      SELECT c.ticker, c.date AS signal_date, c.setup, c.direction, s.sn AS sig_sn
      FROM screener_candidates c
      JOIN _sessions s ON s.ticker = c.ticker AND s.date = c.date
    ),
    entry AS (
      SELECT sig.*, e.sn AS entry_sn, e.date AS entry_date, e.close AS entry_close,
             n.sn AS entry_nsn
      FROM sig
      JOIN _sessions e ON e.ticker = sig.ticker AND e.sn = sig.sig_sn + 1
      JOIN _nifty n ON n.date = e.date
      JOIN _turnover tv ON tv.ticker = sig.ticker AND tv.date = e.date AND tv.t20 >= 50000000
    )
    SELECT
      e.ticker, e.signal_date, e.setup, e.direction, e.entry_date, e.entry_close,
      CASE WHEN e.direction='long' THEN 1 ELSE -1 END *
        (100.0*(s5.close/e.entry_close - 1) - 100.0*(n5.close/ne.close - 1))
        - ${COST_PCT} AS exc_5,
      CASE WHEN e.direction='long' THEN 1 ELSE -1 END *
        (100.0*(s10.close/e.entry_close - 1) - 100.0*(n10.close/ne.close - 1))
        - ${COST_PCT} AS exc_10
    FROM entry e
    JOIN _nifty ne ON ne.sn = e.entry_nsn
    LEFT JOIN _sessions s5  ON s5.ticker = e.ticker AND s5.sn  = e.entry_sn + 5
    LEFT JOIN _nifty    n5  ON n5.sn  = e.entry_nsn + 5
    LEFT JOIN _sessions s10 ON s10.ticker = e.ticker AND s10.sn = e.entry_sn + 10
    LEFT JOIN _nifty    n10 ON n10.sn = e.entry_nsn + 10
    WHERE e.entry_close > 0
  `;
  await sql`CREATE INDEX co_td_idx ON candidate_outcomes (ticker, entry_date)`;
  await sql`ANALYZE candidate_outcomes`;

  const [{ n }] = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM candidate_outcomes WHERE exc_5 IS NOT NULL
  `;
  console.log(`[filter] ${n} priced candidates`);
}

/** Tag each candidate with whether a catalyst preceded it, and how big. */
async function tagCatalysts(): Promise<void> {
  await sql`DROP TABLE IF EXISTS candidate_tagged`;
  await sql`
    CREATE TABLE candidate_tagged AS
    SELECT c.*,
      cat.seq_id IS NOT NULL AS has_catalyst,
      cat.value_cr AS catalyst_value_cr,
      cat.event_type AS catalyst_type
    FROM candidate_outcomes c
    LEFT JOIN LATERAL (
      SELECT t.seq_id, t.event_type, v.value_cr
      FROM _typed_events t
      JOIN _sessions es ON es.ticker = t.symbol AND es.date = (
        SELECT min(date) FROM _sessions s2
        WHERE s2.ticker = t.symbol AND s2.date > t.tradeable_after
      )
      LEFT JOIN order_values v ON v.seq_id = t.seq_id AND v.confidence = 'high'
      JOIN _sessions cs ON cs.ticker = c.ticker AND cs.date = c.entry_date
      WHERE t.symbol = c.ticker
        AND es.sn <= cs.sn
        AND es.sn > cs.sn - ${CATALYST_LOOKBACK_SESSIONS}
      ORDER BY es.sn DESC
      LIMIT 1
    ) cat ON TRUE
  `;
  await sql`ANALYZE candidate_tagged`;
}

async function report(): Promise<void> {
  console.log('\n=== Does a recent catalyst improve screener candidates? ===\n');

  const overall = await sql<Record<string, unknown>[]>`
    SELECT has_catalyst,
      count(*)::text AS n,
      round(avg(exc_5)::numeric, 2) AS mean_t5,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY exc_5)::numeric, 2) AS med_t5,
      round((100.0*avg(CASE WHEN exc_5 > 0 THEN 1 ELSE 0 END))::numeric, 1) AS win_t5,
      round(avg(exc_10)::numeric, 2) AS mean_t10
    FROM candidate_tagged WHERE exc_5 IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `;
  console.log('ALL CANDIDATES');
  console.table(overall);

  const byDir = await sql<Record<string, unknown>[]>`
    SELECT direction, has_catalyst, count(*)::text AS n,
      round(avg(exc_5)::numeric, 2) AS mean_t5,
      round((100.0*avg(CASE WHEN exc_5 > 0 THEN 1 ELSE 0 END))::numeric, 1) AS win_t5
    FROM candidate_tagged WHERE exc_5 IS NOT NULL
    GROUP BY 1,2 ORDER BY 1,2
  `;
  console.log('\nBY DIRECTION');
  console.table(byDir);

  const oos = await sql<Record<string, unknown>[]>`
    SELECT CASE WHEN entry_date < '2024-01-01' THEN 'TRAIN 2019-23' ELSE 'TEST 2024-26' END AS period,
      has_catalyst, count(*)::text AS n,
      round(avg(exc_5)::numeric, 2) AS mean_t5,
      round((100.0*avg(CASE WHEN exc_5 > 0 THEN 1 ELSE 0 END))::numeric, 1) AS win_t5
    FROM candidate_tagged WHERE exc_5 IS NOT NULL
    GROUP BY 1,2 ORDER BY 1 DESC, 2
  `;
  console.log('\nOUT-OF-SAMPLE SPLIT');
  console.table(oos);
}

buildCandidates()
  .then(priceCandidates)
  .then(tagCatalysts)
  .then(report)
  .then(async () => { await sql.end(); })
  .catch(async err => {
    console.error('[filter] fatal:', err);
    await sql.end();
    process.exit(1);
  });
