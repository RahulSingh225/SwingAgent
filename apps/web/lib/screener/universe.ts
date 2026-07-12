/**
 * Universe filter — ROC-based stock ranking.
 *
 * Filters: price > ₹200, avg daily volume > 100K, has indicators.
 * Returns top N stocks sorted by ROC(20) descending.
 *
 * This runs first; entry screeners only operate on the filtered universe.
 */

import { db, schema } from '@/lib/db';
import { desc, eq, gt, and, max } from 'drizzle-orm';

export interface UniverseStock {
  ticker: string;
  close: number;
  volume: number;
  roc20: number;
  // Pass through all indicator fields for downstream screeners
  sma20: number | null;
  sma20Prev: number | null;
  closePrev: number | null;
  ema20: number | null;
  ema50: number | null;
  avgVol20: number | null;
  rsi7: number | null;
  rsi7Prev: number | null;
  stochK: number | null;
  stochKPrev: number | null;
  weeklyTrend: string | null;
  pctFrom52wHigh: number | null;
  atr14: number | null;
}

export async function getUniverse(opts?: {
  topN?: number;
  date?: string;
}): Promise<UniverseStock[]> {
  const topN = opts?.topN ?? 100;

  // Get the latest indicator date if not specified
  let date = opts?.date;
  if (!date) {
    const [row] = await db
      .select({ latest: max(schema.indicators.date) })
      .from(schema.indicators);
    date = row?.latest ?? undefined;
  }
  if (!date) {
    console.warn('[screener/universe] no indicator data found');
    return [];
  }

  // Join indicators with eod_prices for the same date to get close & volume
  const rows = await db
    .select({
      ticker: schema.indicators.ticker,
      close: schema.eodPrices.close,
      volume: schema.eodPrices.volume,
      roc20: schema.indicators.roc20,
      sma20: schema.indicators.sma20,
      sma20Prev: schema.indicators.sma20Prev,
      closePrev: schema.indicators.closePrev,
      ema20: schema.indicators.ema20,
      ema50: schema.indicators.ema50,
      avgVol20: schema.indicators.avgVol20,
      rsi7: schema.indicators.rsi7,
      rsi7Prev: schema.indicators.rsi7Prev,
      stochK: schema.indicators.stochK,
      stochKPrev: schema.indicators.stochKPrev,
      weeklyTrend: schema.indicators.weeklyTrend,
      pctFrom52wHigh: schema.indicators.pctFrom52wHigh,
      atr14: schema.indicators.atr14,
    })
    .from(schema.indicators)
    .innerJoin(
      schema.eodPrices,
      and(
        eq(schema.indicators.ticker, schema.eodPrices.ticker),
        eq(schema.indicators.date, schema.eodPrices.date),
      ),
    )
    .where(
      and(
        eq(schema.indicators.date, date),
        gt(schema.eodPrices.close, 200),      // price > ₹200
        gt(schema.eodPrices.volume, 100000),   // volume > 100K
      ),
    )
    .orderBy(desc(schema.indicators.roc20))
    .limit(topN);

  return rows.filter(r => r.roc20 != null) as UniverseStock[];
}
