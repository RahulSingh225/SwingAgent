/**
 * Intraday bar ingestion from Kite Connect.
 *
 * Scoped deliberately to the LIQUID universe. Only ~696 NSE names carry ≥₹100cr
 * of 20-day turnover, and those are the only ones the gap-fade strategy can
 * actually trade. Ingesting all 3,234 tickers would multiply cost and storage
 * roughly fivefold for names that fail the liquidity filter anyway.
 *
 *   5-min, 700 tickers, 7 years ≈ 93M rows ≈ 8-12 GB with indexes.
 *
 * WHY THIS EXISTS: daily bars cannot test a stop loss. gap-fade-findings.md shows
 * the strategy has mean +0.36% and a worst trade of −51.9%, which caps position
 * size so low the returns are pointless — unless a stop works. Whether price
 * touched −5% before closing +1% is unknowable from daily OHLC. That single
 * question is what this data is for.
 *
 * Resumable per (ticker, window). Fails loudly on an expired token rather than
 * silently writing nothing.
 *
 * Usage:
 *   KITE_API_KEY=... KITE_ACCESS_TOKEN=... \
 *     node scripts/backfill-intraday.ts <fromISO> <toISO> [interval] [windowDays] [minTurnoverCr]
 */

import { sql, checkpoint, doneWindows } from './lib/db.ts';
import { historical, KiteAuthError, addDaysIso } from './lib/kite.ts';

const JOB_PREFIX = 'intraday';

async function ensureSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS intraday_bars (
      ticker   text NOT NULL,
      ts       timestamptz NOT NULL,
      interval text NOT NULL,
      open     double precision NOT NULL,
      high     double precision NOT NULL,
      low      double precision NOT NULL,
      close    double precision NOT NULL,
      volume   bigint NOT NULL,
      PRIMARY KEY (ticker, interval, ts)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS intraday_ts_idx ON intraday_bars (ts)`;
  // Symbol -> instrument_token map, populated by kite-instruments.ts
  await sql`
    CREATE TABLE IF NOT EXISTS kite_instruments (
      tradingsymbol    text PRIMARY KEY,
      instrument_token bigint NOT NULL,
      exchange         text,
      instrument_type  text,
      updated_at       timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function run(): Promise<void> {
  const from = process.argv[2] ?? '2024-01-01';
  const to = process.argv[3] ?? new Date().toISOString().slice(0, 10);
  const interval = process.argv[4] ?? '5minute';
  const windowDays = Number(process.argv[5] ?? 60);
  const minTurnoverCr = Number(process.argv[6] ?? 100);

  await ensureSchema();
  const job = `${JOB_PREFIX}-${interval}`;

  // Liquid universe, joined to Kite tokens.
  const targets = await sql<{ ticker: string; instrument_token: string }[]>`
    SELECT DISTINCT t.ticker, k.instrument_token::text
    FROM _turnover t
    JOIN kite_instruments k ON k.tradingsymbol = t.ticker
    WHERE t.date > (CURRENT_DATE - 365) AND t.t20 >= ${minTurnoverCr * 1e7}
    ORDER BY t.ticker
  `;
  if (targets.length === 0) {
    console.error(
      'No targets. Run scripts/kite-instruments.ts first to populate ' +
      'kite_instruments, and confirm _turnover exists (rebuild-derived-tables.ts).',
    );
    process.exit(1);
  }

  const done = await doneWindows(job);
  console.log(
    `[${job}] ${targets.length} liquid tickers (≥₹${minTurnoverCr}cr), ` +
    `${from} → ${to}, ${windowDays}-day windows, ${done.size} windows done`,
  );

  let fetched = 0, inserted = 0, skipped = 0;

  for (const t of targets) {
    for (let start = from; start <= to; start = addDaysIso(start, windowDays)) {
      const end = addDaysIso(start, windowDays - 1) > to ? to : addDaysIso(start, windowDays - 1);
      const key = `${t.ticker}:${start}`;
      if (done.has(key)) { skipped++; continue; }

      let candles;
      try {
        candles = await historical(Number(t.instrument_token), interval, start, end);
      } catch (err) {
        if (err instanceof KiteAuthError) {
          // Stop the whole run — a stale token would otherwise silently produce
          // an empty backfill that looks complete.
          console.error(`\n[${job}] ${err.message}`);
          console.error(`[${job}] progress is checkpointed; re-run after refreshing the token.`);
          await sql.end();
          process.exit(2);
        }
        throw err;
      }

      if (!candles) {
        await checkpoint(job, key, 0, 'failed', 'no response');
        continue;
      }
      fetched++;

      if (candles.length) {
        const rows = candles.map(c => ({
          ticker: t.ticker, ts: c.ts, interval,
          open: c.open, high: c.high, low: c.low, close: c.close,
          volume: Math.round(c.volume),
        }));
        for (let i = 0; i < rows.length; i += 2000) {
          const chunk = rows.slice(i, i + 2000);
          await sql`
            INSERT INTO intraday_bars ${sql(
              chunk, 'ticker', 'ts', 'interval', 'open', 'high', 'low', 'close', 'volume',
            )}
            ON CONFLICT (ticker, interval, ts) DO NOTHING
          `;
        }
        inserted += rows.length;
      }
      await checkpoint(job, key, candles.length);

      if (fetched % 100 === 0) {
        console.log(`  ${fetched} windows fetched, ${inserted} bars, ${skipped} skipped`);
      }
    }
  }

  const [{ n, tickers }] = await sql<{ n: string; tickers: string }[]>`
    SELECT count(*)::text AS n, count(DISTINCT ticker)::text AS tickers
    FROM intraday_bars WHERE interval = ${interval}
  `;
  console.log(`[${job}] done — ${inserted} bars this run; ${n} total across ${tickers} tickers`);
  await sql.end();
}

run().catch(async err => {
  console.error('[intraday] fatal:', err instanceof Error ? err.message : err);
  await sql.end();
  process.exit(1);
});
