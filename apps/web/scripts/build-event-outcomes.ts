/**
 * Build `event_outcomes` — what actually happened after each announcement.
 *
 * This is the ledger. Everything else in the system is judged by whether it
 * improves the numbers this table produces.
 *
 * Conventions, each chosen to keep the result honest:
 *
 * ENTRY. The first trading session strictly after the announcement, entered at
 *   its CLOSE. Announcements before 09:15 IST can use that same session. Entering
 *   at the close (rather than the open) is deliberately conservative and, more
 *   importantly, lets the stock and the benchmark be measured at identical
 *   timestamps — index opens are not stored, and mixing an open-entry stock leg
 *   with a close-entry index leg would bias every excess return by one overnight
 *   gap. An open-entry variant is a later refinement, not a v1 requirement.
 *
 * RETURNS. Close-to-close over N further sessions, on SPLIT-ADJUSTED prices.
 *
 * EXCESS. Stock return minus NIFTY 50 return over the identical window. A raw
 *   +2.4% in a market that rose 2% is not an edge.
 *
 * COSTS. A flat round-trip deduction (brokerage + STT + impact). Smallcap
 *   catalysts are exactly where this decides edge vs no edge.
 *
 * EXCLUSIONS. Exchange surveillance notices ("Price movement", "Spurt in
 *   Volume", "News Verification") are dropped: they are the exchange asking why a
 *   stock ALREADY moved, so including them guarantees look-ahead contamination.
 *   Illiquid names are dropped as untradeable. Overlapping events on one ticker
 *   keep only the first.
 *
 * REGIME is recorded, never filtered on — whether catalysts lose money in
 *   downtrends is a question for the ledger to answer, not an assumption to bake in.
 *
 * Usage: node scripts/build-event-outcomes.ts
 */

import { sql } from './lib/db.ts';

/** Round-trip cost in percentage points: brokerage + STT + slippage. */
const ROUND_TRIP_COST_PCT = 0.35;
/** Minimum 20-day average daily turnover (₹) for a name to count as tradeable. */
const MIN_TURNOVER_INR = 50_000_000; // ₹5 Cr
/** Sessions within which a second event on the same ticker is treated as overlap. */
const OVERLAP_SESSIONS = 10;
const HORIZONS = [1, 3, 5, 10] as const;

async function createTable(): Promise<void> {
  await sql`DROP TABLE IF EXISTS event_outcomes`;
  await sql`
    CREATE TABLE event_outcomes (
      seq_id        text PRIMARY KEY,
      symbol        text NOT NULL,
      event_type    text NOT NULL,
      category      text,
      announced_at  timestamptz NOT NULL,
      entry_date    date NOT NULL,
      entry_close   double precision NOT NULL,
      turnover_20d  double precision,
      regime        text,
      ret_1  double precision, exc_1  double precision,
      ret_3  double precision, exc_3  double precision,
      ret_5  double precision, exc_5  double precision,
      ret_10 double precision, exc_10 double precision
    )
  `;
  await sql`CREATE INDEX event_outcomes_type_idx ON event_outcomes (event_type)`;
  await sql`CREATE INDEX event_outcomes_entry_idx ON event_outcomes (entry_date)`;
}

/**
 * Materialise the per-session helpers as indexed tables.
 *
 * As CTEs these cannot be indexed, so the eight horizon joins each degenerate
 * into a scan of 3.2M rows and the query runs for over ten minutes. As real
 * tables with a primary key on (ticker, session_number) the same joins become
 * index lookups.
 */
async function buildHelpers(): Promise<void> {
  console.log('[ledger] materialising session helpers …');

  await sql`DROP TABLE IF EXISTS _sessions`;
  await sql`
    CREATE TABLE _sessions AS
    SELECT ticker, date, close, close_raw, volume,
           row_number() OVER (PARTITION BY ticker ORDER BY date) AS sn
    FROM eod_prices_adj
  `;
  await sql`CREATE UNIQUE INDEX _sessions_pk ON _sessions (ticker, sn)`;
  await sql`CREATE UNIQUE INDEX _sessions_td ON _sessions (ticker, date)`;

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

  await sql`DROP TABLE IF EXISTS _nifty`;
  await sql`
    CREATE TABLE _nifty AS
    SELECT date, close,
           row_number() OVER (ORDER BY date) AS sn,
           avg(close) OVER (ORDER BY date ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS sma50
    FROM index_prices
    WHERE index_name = 'NIFTY 50'
  `;
  await sql`CREATE UNIQUE INDEX _nifty_sn ON _nifty (sn)`;
  await sql`CREATE UNIQUE INDEX _nifty_date ON _nifty (date)`;

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
        WHEN a.attachment_text ~* 'letter of (intent|award)|\\mloi\\M|\\mloa\\M'  THEN 'loi-loa'
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

  await sql`ANALYZE _sessions`;
  await sql`ANALYZE _turnover`;
  await sql`ANALYZE _nifty`;
  await sql`ANALYZE _typed_events`;

  const [{ n }] = await sql`SELECT count(*)::text AS n FROM _typed_events`;
  console.log(`[ledger] ${n} typed events to price`);
}

async function populate(): Promise<void> {
  const horizonCols = HORIZONS.flatMap(h => [`ret_${h}`, `exc_${h}`]).join(', ');

  // Stock leg and index leg both measured close-to-close from the entry session.
  const horizonSelect = HORIZONS.map(h => `
      100.0 * (s${h}.close / e.entry_close - 1)                       AS ret_${h},
      100.0 * (s${h}.close / e.entry_close - 1)
        - 100.0 * (n${h}.close / ne.close - 1)
        - ${ROUND_TRIP_COST_PCT}                                      AS exc_${h}`).join(',');

  const horizonJoins = HORIZONS.map(h => `
    LEFT JOIN _sessions s${h}
      ON s${h}.ticker = e.symbol AND s${h}.sn = e.entry_sn + ${h}
    LEFT JOIN _nifty n${h}
      ON n${h}.sn = e.entry_nsn + ${h}`).join('');

  const query = `
    INSERT INTO event_outcomes (
      seq_id, symbol, event_type, category, announced_at,
      entry_date, entry_close, turnover_20d, regime, ${horizonCols}
    )
    WITH typed AS (SELECT * FROM _typed_events),
    -- First session strictly after the announcement becomes the entry bar.
    entries AS (
      SELECT
        t.seq_id, t.symbol, t.event_type, t.category, t.announced_at,
        s.date AS entry_date, s.close AS entry_close, s.sn AS entry_sn,
        n.sn AS entry_nsn,
        CASE WHEN n.close >= n.sma50 THEN 'up' ELSE 'down' END AS regime,
        tv.t20 AS turnover_20d
      FROM typed t
      CROSS JOIN LATERAL (
        SELECT sn, date, close FROM _sessions
        WHERE ticker = t.symbol AND date > t.tradeable_after
        ORDER BY date LIMIT 1
      ) s
      LEFT JOIN _nifty n ON n.date = s.date
      LEFT JOIN _turnover tv ON tv.ticker = t.symbol AND tv.date = s.date
    ),
    -- Overlap: keep only the first event per ticker within the horizon window.
    deduped AS (
      SELECT *, lag(entry_sn) OVER (PARTITION BY symbol ORDER BY entry_sn) AS prev_sn
      FROM entries
    ),
    e AS (
      SELECT * FROM deduped
      WHERE prev_sn IS NULL OR entry_sn - prev_sn > ${OVERLAP_SESSIONS}
    )
    SELECT
      e.seq_id, e.symbol, e.event_type, e.category, e.announced_at,
      e.entry_date, e.entry_close, e.turnover_20d, e.regime,
      ${horizonSelect}
    FROM e
    LEFT JOIN _nifty ne ON ne.sn = e.entry_nsn
    ${horizonJoins}
    WHERE e.entry_close > 0
      AND e.turnover_20d >= ${MIN_TURNOVER_INR}
      AND e.entry_nsn IS NOT NULL
  `;

  await sql.unsafe(query);
}

async function report(): Promise<void> {
  const [{ n }] = await sql<{ n: string }[]>`SELECT count(*) AS n FROM event_outcomes`;
  console.log(`[ledger] ${n} events with outcomes\n`);

  const rows = await sql<{
    event_type: string; n: string; regime: string;
    med5: number | null; win5: number | null; med10: number | null;
  }[]>`
    SELECT event_type,
           count(*)::text AS n,
           'all' AS regime,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY exc_5)::numeric, 2)  AS med5,
           round((100.0 * avg(CASE WHEN exc_5 > 0 THEN 1 ELSE 0 END))::numeric, 1) AS win5,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY exc_10)::numeric, 2) AS med10
    FROM event_outcomes
    WHERE exc_5 IS NOT NULL
    GROUP BY event_type
    ORDER BY count(*) DESC
  `;

  console.log('Base rates — excess return vs NIFTY 50, net of costs');
  console.log('  event_type        n      median T+5   win% T+5   median T+10');
  for (const r of rows) {
    const thin = Number(r.n) < 30 ? '  [THIN]' : '';
    console.log(
      `  ${r.event_type.padEnd(16)} ${String(r.n).padStart(5)}   ` +
      `${String(r.med5).padStart(9)}%  ${String(r.win5).padStart(8)}%   ` +
      `${String(r.med10).padStart(10)}%${thin}`,
    );
  }
}

createTable()
  .then(buildHelpers)
  .then(populate)
  .then(report)
  .then(async () => { await sql.end(); })
  .catch(async err => {
    console.error('[ledger] fatal:', err);
    await sql.end();
    process.exit(1);
  });
