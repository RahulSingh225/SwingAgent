/**
 * Compute screener indicators for every (ticker, date) in history.
 *
 * `indicators` only ever held the latest session, so the screener has never been
 * evaluated over the past. Testing catalyst-as-filter needs its candidates for
 * all 1,773 sessions.
 *
 * Formulas are ported from @market-os/intel/indicators.ts and must stay
 * byte-identical in behaviour — a backtest of subtly different rules answers a
 * question nobody asked. The difference here is only mechanical: intel
 * recomputes each indicator from the whole array for one bar (O(n²) across a
 * series), while this streams each ticker once and emits every bar. Seeding is
 * the same, so the values match.
 *
 * Indicators use SPLIT-ADJUSTED prices — an unadjusted 1:10 split would fire a
 * spurious "close crossed below SMA20" on every screener. The universe's ₹200
 * price floor deliberately uses the RAW close instead, because that is the price
 * a trader actually saw on the day.
 *
 * Usage: node scripts/build-historical-indicators.ts
 */

import { sql } from './lib/db.ts';

interface Bar {
  date: string;
  open: number; high: number; low: number; close: number;
  close_raw: number; volume: number;
}

interface Row {
  ticker: string; date: string;
  close_raw: number; volume: number;
  sma20: number | null; sma20_prev: number | null; close_prev: number | null;
  ema20: number | null; ema50: number | null; weekly_trend: string | null;
  rsi7: number | null; rsi7_prev: number | null;
  stoch_k: number | null; stoch_k_prev: number | null;
  roc20: number | null;
}

/** Wilder RSI, seeded on the first `period` changes — matches intel exactly. */
function rsiSeries(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch > 0) avgGain += ch; else avgLoss -= ch;
  }
  avgGain /= period; avgLoss /= period;
  const val = () =>
    avgLoss === 0 ? (avgGain === 0 ? 50 : 100)
                  : 100 - 100 / (1 + avgGain / avgLoss);
  out[period] = val();
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = val();
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values — matches intel. */
function emaSeries(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  const k = 2 / (period + 1);
  let cur = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = cur;
  for (let i = period; i < closes.length; i++) {
    cur = closes[i] * k + cur * (1 - k);
    out[i] = cur;
  }
  return out;
}

function smaSeries(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= period) sum -= vals[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Slow %K: SMA(raw %K over kPeriod, dPeriod). */
function slowStochSeries(bars: Bar[], kPeriod: number, dPeriod: number): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  const rawK: number[] = [];
  const rawIdx: number[] = [];
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (bars[j].low < lo) lo = bars[j].low;
      if (bars[j].high > hi) hi = bars[j].high;
    }
    const range = hi - lo;
    rawK.push(range > 0 ? ((bars[i].close - lo) / range) * 100 : 50);
    rawIdx.push(i);
  }
  let sum = 0;
  for (let i = 0; i < rawK.length; i++) {
    sum += rawK[i];
    if (i >= dPeriod) sum -= rawK[i - dPeriod];
    if (i >= dPeriod - 1) out[rawIdx[i]] = sum / dPeriod;
  }
  return out;
}

function trend(e20: number | null, e50: number | null): string | null {
  if (e20 == null || e50 == null || e50 === 0) return null;
  const diff = ((e20 - e50) / e50) * 100;
  return diff > 0.1 ? 'UP' : diff < -0.1 ? 'DOWN' : 'FLAT';
}

async function run(): Promise<void> {
  await sql`DROP TABLE IF EXISTS hist_indicators`;
  await sql`
    CREATE TABLE hist_indicators (
      ticker text NOT NULL, date date NOT NULL,
      close_raw double precision, volume bigint,
      sma20 double precision, sma20_prev double precision, close_prev double precision,
      ema20 double precision, ema50 double precision, weekly_trend text,
      rsi7 double precision, rsi7_prev double precision,
      stoch_k double precision, stoch_k_prev double precision,
      roc20 double precision,
      PRIMARY KEY (ticker, date)
    )
  `;

  const tickers = await sql<{ ticker: string }[]>`
    SELECT ticker FROM eod_prices_adj GROUP BY ticker HAVING count(*) >= 60 ORDER BY ticker
  `;
  console.log(`[indicators] ${tickers.length} tickers with >=60 bars`);

  let done = 0, written = 0;
  for (const { ticker } of tickers) {
    const bars = await sql<Bar[]>`
      SELECT date::text AS date, open, high, low, close, close_raw, volume
      FROM eod_prices_adj WHERE ticker = ${ticker} ORDER BY date
    `;
    if (bars.length < 60) continue;

    const closes = bars.map(b => Number(b.close));
    const sma20 = smaSeries(closes, 20);
    const ema20 = emaSeries(closes, 20);
    const ema50 = emaSeries(closes, 50);
    const rsi7 = rsiSeries(closes, 7);
    const stochK = slowStochSeries(bars, 7, 10);

    const rows: Row[] = [];
    for (let i = 1; i < bars.length; i++) {
      const roc20 = i >= 20 && closes[i - 20] > 0
        ? ((closes[i] - closes[i - 20]) / closes[i - 20]) * 100
        : null;
      rows.push({
        ticker, date: bars[i].date,
        close_raw: Number(bars[i].close_raw), volume: Number(bars[i].volume),
        sma20: sma20[i], sma20_prev: sma20[i - 1], close_prev: closes[i - 1],
        ema20: ema20[i], ema50: ema50[i], weekly_trend: trend(ema20[i], ema50[i]),
        rsi7: rsi7[i], rsi7_prev: rsi7[i - 1],
        stoch_k: stochK[i], stoch_k_prev: stochK[i - 1],
        roc20,
      });
    }

    for (let i = 0; i < rows.length; i += 2000) {
      const chunk = rows.slice(i, i + 2000);
      await sql`
        INSERT INTO hist_indicators ${sql(
          chunk, 'ticker', 'date', 'close_raw', 'volume', 'sma20', 'sma20_prev',
          'close_prev', 'ema20', 'ema50', 'weekly_trend', 'rsi7', 'rsi7_prev',
          'stoch_k', 'stoch_k_prev', 'roc20',
        )}
        ON CONFLICT (ticker, date) DO NOTHING
      `;
    }
    written += rows.length;
    if (++done % 300 === 0) {
      console.log(`  ${done}/${tickers.length} tickers, ${written} rows`);
    }
  }

  await sql`CREATE INDEX hist_ind_date_idx ON hist_indicators (date)`;
  await sql`ANALYZE hist_indicators`;
  console.log(`[indicators] done — ${written} rows across ${done} tickers`);
  await sql.end();
}

run().catch(async err => {
  console.error('[indicators] fatal:', err);
  await sql.end();
  process.exit(1);
});
