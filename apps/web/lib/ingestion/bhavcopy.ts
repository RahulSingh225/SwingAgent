/**
 * NSE EOD ingestion — 18:45 IST daily.
 *
 * 1. sec_bhavdata_full CSV → `eod_prices` (OHLCV + delivery %)
 * 2. ind_close_all CSV → `sector_snapshot` (all indices, % change)
 * 3. market breadth (advance/decline over EQ series) → 'NSE:ALL' row
 * 4. indicators for the latest trading day via @market-os/intel math
 *
 * `backfillDays` re-ingests history so EMAs/RSI have data to converge on
 * (~400 calendar days recommended before trusting ema200).
 */

import { parse } from 'csv-parse/sync';
import { and, eq, gte, inArray, max, sql } from 'drizzle-orm';
import { computeIndicators, type OhlcvBar } from '@market-os/intel';
import { db } from '@/lib/db';
import { eodPrices, indicators, sectorSnapshot } from '@/lib/db/schema';
import { BROWSER_HEADERS, ddmmyyyy, isoDate } from './types';

const ARCHIVES = 'https://nsearchives.nseindia.com';
/** Breadth pseudo-index: advance/decline across all EQ-series stocks. */
export const MARKET_BREADTH_INDEX = 'NSE:ALL';

function num(v: unknown): number | null {
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

async function fetchCsv(url: string): Promise<Record<string, string>[] | null> {
  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 404) {
    return null; // holiday / file not published yet
  }
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  const text = await res.text();
  return parse(text, {
    columns: (header: string[]) => header.map(h => h.trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];
}

/** Ingest one trading day. Returns null when NSE has no file (holiday). */
async function ingestDay(day: Date): Promise<{ prices: number; indices: number } | null> {
  const stamp = ddmmyyyy(day);
  const date = isoDate(day);

  const rows = await fetchCsv(`${ARCHIVES}/products/content/sec_bhavdata_full_${stamp}.csv`);
  if (!rows) {
    return null;
  }

  const eq_ = rows.filter(r => (r.SERIES ?? '').trim() === 'EQ');
  let advance = 0;
  let decline = 0;

  const priceRows = eq_.flatMap(r => {
    const open = num(r.OPEN_PRICE);
    const high = num(r.HIGH_PRICE);
    const low = num(r.LOW_PRICE);
    const close = num(r.CLOSE_PRICE);
    const volume = num(r.TTL_TRD_QNTY);
    if (open === null || high === null || low === null || close === null || volume === null) {
      return [];
    }
    const prev = num(r.PREV_CLOSE);
    if (prev !== null) {
      if (close > prev) advance++;
      else if (close < prev) decline++;
    }
    return [{
      ticker: (r.SYMBOL ?? '').trim(),
      date,
      open,
      high,
      low,
      close,
      volume,
      deliveryPct: num(r.DELIV_PER),
    }];
  });

  for (let i = 0; i < priceRows.length; i += 500) {
    await db
      .insert(eodPrices)
      .values(priceRows.slice(i, i + 500))
      .onConflictDoNothing();
  }

  // Sectoral / broad indices (separate file — tolerate absence)
  let indexCount = 0;
  try {
    const idxRows = await fetchCsv(`${ARCHIVES}/content/indices/ind_close_all_${stamp}.csv`);
    if (idxRows) {
      const snapshotRows = idxRows.flatMap(r => {
        const name = (r['Index Name'] ?? '').trim().toUpperCase();
        const pct = num(r['Change(%)']);
        if (!name || pct === null) {
          return [];
        }
        return [{ indexName: name, date, pctChange: pct, advance: null, decline: null }];
      });
      indexCount = snapshotRows.length;
      for (let i = 0; i < snapshotRows.length; i += 500) {
        await db
          .insert(sectorSnapshot)
          .values(snapshotRows.slice(i, i + 500))
          .onConflictDoUpdate({
            target: [sectorSnapshot.indexName, sectorSnapshot.date],
            set: { pctChange: sql`excluded.pct_change` },
          });
      }
    }
  } catch (err) {
    console.warn('[bhavcopy] index file failed (non-fatal):', err instanceof Error ? err.message : err);
  }

  await db
    .insert(sectorSnapshot)
    .values({ indexName: MARKET_BREADTH_INDEX, date, pctChange: 0, advance, decline })
    .onConflictDoUpdate({
      target: [sectorSnapshot.indexName, sectorSnapshot.date],
      set: { advance, decline },
    });

  console.log(`[bhavcopy] ${date}: ${priceRows.length} tickers, ${indexCount} indices, A/D ${advance}/${decline}`);
  return { prices: priceRows.length, indices: indexCount };
}

/** Recompute `indicators` for every ticker on the latest stored date. */
export async function computeIndicatorsForLatest(): Promise<{ date: string; tickers: number } | null> {
  const [{ latest }] = await db.select({ latest: max(eodPrices.date) }).from(eodPrices);
  if (!latest) {
    return null;
  }

  const tickerRows = await db
    .selectDistinct({ ticker: eodPrices.ticker })
    .from(eodPrices)
    .where(eq(eodPrices.date, latest));
  const tickers = tickerRows.map(r => r.ticker);

  const cutoff = isoDate(new Date(Date.now() - 600 * 86400000));
  let computed = 0;

  for (let i = 0; i < tickers.length; i += 200) {
    const chunk = tickers.slice(i, i + 200);
    const bars = await db
      .select()
      .from(eodPrices)
      .where(and(inArray(eodPrices.ticker, chunk), gte(eodPrices.date, cutoff)))
      .orderBy(eodPrices.ticker, eodPrices.date);

    const byTicker = new Map<string, OhlcvBar[]>();
    for (const b of bars) {
      const list = byTicker.get(b.ticker) ?? [];
      list.push({ open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
      byTicker.set(b.ticker, list);
    }

    const rows = [...byTicker.entries()].map(([ticker, series]) => {
      const ind = computeIndicators(series);
      return {
        ticker,
        date: latest,
        ema20: ind.ema20,
        ema50: ind.ema50,
        ema200: ind.ema200,
        avgVol20: ind.avgVol20,
        atr14: ind.atr14,
        pctFrom52wHigh: ind.pctFrom52wHigh,
        rsi14: ind.rsi14,
        // Phase 4
        sma20: ind.sma20,
        sma20Prev: ind.sma20Prev,
        closePrev: ind.closePrev,
        roc20: ind.roc20,
        rsi7: ind.rsi7,
        rsi7Prev: ind.rsi7Prev,
        stochK: ind.stochK,
        stochKPrev: ind.stochKPrev,
        weeklyTrend: ind.weeklyTrendVal,
      };
    });

    for (let j = 0; j < rows.length; j += 500) {
      await db
        .insert(indicators)
        .values(rows.slice(j, j + 500))
        .onConflictDoUpdate({
          target: [indicators.ticker, indicators.date],
          set: {
            ema20: sql`excluded.ema20`,
            ema50: sql`excluded.ema50`,
            ema200: sql`excluded.ema200`,
            avgVol20: sql`excluded.avg_vol_20`,
            atr14: sql`excluded.atr14`,
            pctFrom52wHigh: sql`excluded.pct_from_52w_high`,
            rsi14: sql`excluded.rsi14`,
            sma20: sql`excluded.sma20`,
            sma20Prev: sql`excluded.sma20_prev`,
            closePrev: sql`excluded.close_prev`,
            roc20: sql`excluded.roc20`,
            rsi7: sql`excluded.rsi7`,
            rsi7Prev: sql`excluded.rsi7_prev`,
            stochK: sql`excluded.stoch_k`,
            stochKPrev: sql`excluded.stoch_k_prev`,
            weeklyTrend: sql`excluded.weekly_trend`,
          },
        });
    }
    computed += rows.length;
  }

  console.log(`[bhavcopy] indicators computed for ${computed} tickers @ ${latest}`);
  return { date: latest, tickers: computed };
}

export interface BhavcopyResult {
  daysIngested: number;
  latestDay: string | null;
  indicators: { date: string; tickers: number } | null;
}

export async function runBhavcopy(opts?: { backfillDays?: number }): Promise<BhavcopyResult> {
  let daysIngested = 0;
  let latestDay: string | null = null;

  if (opts?.backfillDays && opts.backfillDays > 0) {
    for (let i = opts.backfillDays; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400000);
      const dow = day.getUTCDay();
      if (dow === 0 || dow === 6) {
        continue; // weekend — no file
      }
      try {
        const result = await ingestDay(day);
        if (result) {
          daysIngested++;
          latestDay = isoDate(day);
        }
      } catch (err) {
        console.warn(`[bhavcopy] ${isoDate(day)} failed:`, err instanceof Error ? err.message : err);
      }
      await new Promise(r => setTimeout(r, 700)); // be polite to NSE archives
    }
  } else {
    // Latest available trading day: walk back up to a week
    for (let i = 0; i < 7; i++) {
      const day = new Date(Date.now() - i * 86400000);
      const result = await ingestDay(day);
      if (result) {
        daysIngested = 1;
        latestDay = isoDate(day);
        break;
      }
    }
  }

  const ind = daysIngested > 0 ? await computeIndicatorsForLatest() : null;
  return { daysIngested, latestDay, indicators: ind };
}
