/**
 * Detect directional waves and exhaustion candles for the wave-fade study.
 *
 * Wave      — >= 3 consecutive sessions of higher-high AND higher-low (up), or
 *             lower-high AND lower-low (down).
 * Exhaustion— a candle whose body is small relative to its full range;
 *             body_ratio = |close - open| / (high - low). The threshold is NOT
 *             fixed here: body_ratio is stored per signal so the analysis can
 *             sweep it, which is more informative than committing to one value
 *             (and the handover spec was truncated before stating it).
 * Fade      — enter at the NEXT session's open, opposite to the wave.
 *
 * All detection runs on SPLIT-ADJUSTED OHLC. An unadjusted 1:10 split would
 * manufacture a spurious "lower high and lower low" wave day on every split.
 *
 * Also recorded so both study variants come from one code path:
 *   wave_len         — sessions in the wave at the exhaustion candle
 *   wave_move_pct    — move across the wave, for cutting by extension
 *   start_gap_pct    — gap on the first wave session (Variant B's filter)
 *   prior_gap_pct    — gap on the session before the wave began
 *   turnover_20d     — liquidity floor
 *
 * Usage: node scripts/build-wave-signals.ts
 */

import { sql } from './lib/db.ts';

interface Bar {
  date: string;
  open: number; high: number; low: number; close: number;
  close_raw: number; volume: number;
}

interface Signal {
  ticker: string;
  signal_date: string;
  direction: string;        // fade direction: 'short' after an up-wave
  wave_dir: string;
  wave_len: number;
  wave_move_pct: number;
  body_ratio: number;
  range_pct: number;
  start_gap_pct: number | null;
  prior_gap_pct: number | null;
}

async function run(): Promise<void> {
  await sql`DROP TABLE IF EXISTS wave_signals`;
  await sql`
    CREATE TABLE wave_signals (
      ticker text NOT NULL,
      signal_date date NOT NULL,
      direction text NOT NULL,
      wave_dir text NOT NULL,
      wave_len integer NOT NULL,
      wave_move_pct double precision,
      body_ratio double precision,
      range_pct double precision,
      start_gap_pct double precision,
      prior_gap_pct double precision,
      PRIMARY KEY (ticker, signal_date)
    )
  `;

  const tickers = await sql<{ ticker: string }[]>`
    SELECT ticker FROM eod_prices_adj GROUP BY ticker HAVING count(*) >= 60 ORDER BY ticker
  `;
  console.log(`[waves] scanning ${tickers.length} tickers`);

  let done = 0;
  let total = 0;

  for (const { ticker } of tickers) {
    const bars = await sql<Bar[]>`
      SELECT date::text AS date, open, high, low, close, close_raw, volume
      FROM eod_prices_adj WHERE ticker = ${ticker} ORDER BY date
    `;
    if (bars.length < 10) continue;

    const sig: Signal[] = [];
    let runDir: 'up' | 'down' | null = null;
    let runStart = 0;   // index of the first bar OF the wave
    let runLen = 0;

    for (let i = 1; i < bars.length; i++) {
      const b = bars[i], p = bars[i - 1];
      const up = b.high > p.high && b.low > p.low;
      const down = b.high < p.high && b.low < p.low;

      // Extend, start, or break the current run.
      if (up && runDir === 'up') {
        runLen++;
      } else if (down && runDir === 'down') {
        runLen++;
      } else if (up) {
        runDir = 'up'; runLen = 1; runStart = i;
      } else if (down) {
        runDir = 'down'; runLen = 1; runStart = i;
      } else {
        // Neither: the wave has stalled. This candle is the exhaustion
        // candidate if a qualifying wave immediately preceded it.
        if (runDir && runLen >= 3) {
          const range = b.high - b.low;
          if (range > 0 && b.open > 0) {
            const first = bars[runStart];
            const beforeWave = runStart > 0 ? bars[runStart - 1] : null;
            const waveMove = ((bars[i - 1].close - first.open) / first.open) * 100;
            sig.push({
              ticker,
              signal_date: b.date,
              // Fade: short after an up-wave, long after a down-wave.
              direction: runDir === 'up' ? 'short' : 'long',
              wave_dir: runDir,
              wave_len: runLen,
              wave_move_pct: waveMove,
              body_ratio: Math.abs(b.close - b.open) / range,
              range_pct: (range / b.open) * 100,
              start_gap_pct: beforeWave
                ? ((first.open - beforeWave.close) / beforeWave.close) * 100
                : null,
              prior_gap_pct:
                beforeWave && runStart > 1
                  ? ((beforeWave.open - bars[runStart - 2].close) / bars[runStart - 2].close) * 100
                  : null,
            });
          }
        }
        runDir = null; runLen = 0;
      }
    }

    for (let i = 0; i < sig.length; i += 1000) {
      const chunk = sig.slice(i, i + 1000);
      await sql`
        INSERT INTO wave_signals ${sql(
          chunk, 'ticker', 'signal_date', 'direction', 'wave_dir', 'wave_len',
          'wave_move_pct', 'body_ratio', 'range_pct', 'start_gap_pct', 'prior_gap_pct',
        )}
        ON CONFLICT DO NOTHING
      `;
    }
    total += sig.length;
    if (++done % 500 === 0) console.log(`  ${done}/${tickers.length} tickers, ${total} signals`);
  }

  await sql`CREATE INDEX wave_sig_date_idx ON wave_signals (signal_date)`;
  await sql`ANALYZE wave_signals`;
  console.log(`[waves] done — ${total} wave-exhaustion signals`);

  const dist = await sql<Record<string, unknown>[]>`
    SELECT wave_dir, count(*)::text AS n,
      round(avg(wave_len)::numeric,2) AS avg_len,
      round(avg(wave_move_pct)::numeric,2) AS avg_move_pct,
      round(avg(body_ratio)::numeric,3) AS avg_body_ratio,
      count(*) FILTER (WHERE body_ratio < 0.30)::text AS body_lt_030
    FROM wave_signals GROUP BY 1 ORDER BY 1
  `;
  console.table(dist);
  await sql.end();
}

run().catch(async err => {
  console.error('[waves] fatal:', err);
  await sql.end();
  process.exit(1);
});
