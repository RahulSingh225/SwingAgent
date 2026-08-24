/**
 * Rebuild the derived helper tables after a migration restore.
 *
 * These are excluded from the dump (~1.6 GB of the 5.9 GB database) because they
 * are pure functions of `eod_prices_adj`, `index_prices` and `announcements_raw`.
 * Shipping them would triple the transfer for no information.
 *
 * They exist at all because Postgres cannot index a CTE: the ledger query joined
 * a 3.2M-row CTE eight times and ran for over ten minutes before being killed.
 * As indexed tables the same joins are index lookups.
 *
 * Run order matters — `eod_prices_adj` is a materialised view over
 * `eod_prices` + `corporate_actions`, so build-adjusted-prices.ts must have run
 * first (and detect-split-dates.ts before that).
 *
 * Usage: node scripts/rebuild-derived-tables.ts
 */

import { sql } from './lib/db.ts';

async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  const t0 = Date.now();
  process.stdout.write(`  ${name.padEnd(28)} … `);
  await fn();
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function run(): Promise<void> {
  console.log('[rebuild] derived tables');

  await step('_sessions', async () => {
    await sql`DROP TABLE IF EXISTS _sessions`;
    await sql`
      CREATE TABLE _sessions AS
      SELECT ticker, date, close, close_raw, volume,
             row_number() OVER (PARTITION BY ticker ORDER BY date) AS sn
      FROM eod_prices_adj
    `;
    await sql`CREATE UNIQUE INDEX _sessions_pk ON _sessions (ticker, sn)`;
    await sql`CREATE UNIQUE INDEX _sessions_td ON _sessions (ticker, date)`;
  });

  await step('_sessions_o (with open)', async () => {
    await sql`DROP TABLE IF EXISTS _sessions_o`;
    await sql`
      CREATE TABLE _sessions_o AS
      SELECT ticker, date, open, high, low, close, close_raw, volume,
             row_number() OVER (PARTITION BY ticker ORDER BY date) AS sn
      FROM eod_prices_adj
    `;
    await sql`CREATE UNIQUE INDEX _sessions_o_pk ON _sessions_o (ticker, sn)`;
    await sql`CREATE UNIQUE INDEX _sessions_o_td ON _sessions_o (ticker, date)`;
  });

  await step('_nifty', async () => {
    await sql`DROP TABLE IF EXISTS _nifty`;
    await sql`
      CREATE TABLE _nifty AS
      SELECT date, close, open,
             row_number() OVER (ORDER BY date) AS sn,
             avg(close) OVER (ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS sma50
      FROM index_prices WHERE index_name = 'NIFTY 50'
    `;
    await sql`CREATE UNIQUE INDEX _nifty_sn ON _nifty (sn)`;
    await sql`CREATE UNIQUE INDEX _nifty_date ON _nifty (date)`;
  });

  await step('_turnover', async () => {
    await sql`DROP TABLE IF EXISTS _turnover`;
    await sql`
      CREATE TABLE _turnover AS
      SELECT ticker, date,
             avg(close_raw * volume) OVER (
               PARTITION BY ticker ORDER BY date ROWS BETWEEN 20 PRECEDING AND 1 PRECEDING
             ) AS t20
      FROM eod_prices_adj
    `;
    await sql`CREATE UNIQUE INDEX _turnover_pk ON _turnover (ticker, date)`;
  });

  await step('_volratio', async () => {
    await sql`DROP TABLE IF EXISTS _volratio`;
    await sql`
      CREATE TABLE _volratio AS
      SELECT ticker, date, volume,
             avg(volume) OVER (
               PARTITION BY ticker ORDER BY date ROWS BETWEEN 20 PRECEDING AND 1 PRECEDING
             ) AS avgvol20
      FROM eod_prices_adj
    `;
    await sql`CREATE UNIQUE INDEX _volratio_pk ON _volratio (ticker, date)`;
  });

  await step('_typed_events', async () => {
    await sql`DROP TABLE IF EXISTS _typed_events`;
    await sql`
      CREATE TABLE _typed_events AS
      SELECT
        a.seq_id, a.symbol, a.category, a.announced_at,
        CASE
          WHEN (a.announced_at AT TIME ZONE 'Asia/Kolkata')::time < '09:15'
            THEN (a.announced_at AT TIME ZONE 'Asia/Kolkata')::date - 1
          ELSE (a.announced_at AT TIME ZONE 'Asia/Kolkata')::date
        END AS tradeable_after,
        CASE
          WHEN a.attachment_text ~* '(emerges|declared).{0,25}(l-?1|lowest bidder)' THEN 'l1-bid'
          -- NOTE: backslashes are DOUBLED because this is a JS template literal.
          -- '\\m' / '\\M' are Postgres word-boundary anchors; writing them singly
          -- here silently collapses to plain 'm'/'M' and the pattern stops
          -- matching (it cost 248 loi-loa rows before this was caught).
          WHEN a.attachment_text ~* 'letter of (intent|award)|\\mloi\\M|\\mloa\\M' THEN 'loi-loa'
          WHEN a.attachment_text ~* 'work order|purchase order|order (win|worth|received|bagg)|bags .{0,20}order|secures .{0,20}(order|contract)|awarded .{0,20}(order|contract)|receipt of order' THEN 'firm-order'
          WHEN a.attachment_text ~* 'contract'                                      THEN 'contract-other'
        END AS event_type
      FROM announcements_raw a
      WHERE a.symbol IS NOT NULL
        AND a.announced_at >= '2019-10-01'
        AND a.category NOT IN ('Price movement', 'Spurt in Volume', 'News Verification')
    `;
    await sql`DELETE FROM _typed_events WHERE event_type IS NULL`;
    await sql`CREATE INDEX _typed_events_sym ON _typed_events (symbol, tradeable_after)`;
  });

  await step('ANALYZE', async () => {
    for (const t of ['_sessions', '_sessions_o', '_nifty', '_turnover', '_volratio', '_typed_events']) {
      await sql.unsafe(`ANALYZE ${t}`);
    }
  });

  const counts = await sql<{ t: string; n: string }[]>`
    SELECT '_sessions' AS t, count(*)::text AS n FROM _sessions
    UNION ALL SELECT '_sessions_o', count(*)::text FROM _sessions_o
    UNION ALL SELECT '_nifty', count(*)::text FROM _nifty
    UNION ALL SELECT '_turnover', count(*)::text FROM _turnover
    UNION ALL SELECT '_volratio', count(*)::text FROM _volratio
    UNION ALL SELECT '_typed_events', count(*)::text FROM _typed_events
  `;
  console.log('\n[rebuild] row counts:');
  for (const c of counts) console.log(`  ${c.t.padEnd(16)} ${c.n}`);
  await sql.end();
}

run().catch(async err => {
  console.error('[rebuild] fatal:', err);
  await sql.end();
  process.exit(1);
});
