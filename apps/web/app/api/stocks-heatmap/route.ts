/**
 * GET /api/stocks-heatmap — top stocks for the treemap heatmap.
 *
 * Query params:
 *   limit — max rows (default 60, cap 200)
 *   date  — YYYY-MM-DD (default: latest eod_prices date)
 *
 * Response:
 *   {
 *     "stocks": [
 *       {
 *         "symbol": "RELIANCE",
 *         "name": "Reliance Industries",
 *         "pctChange": 1.85,
 *         "marketCap": 18500000000000,
 *         "sector": "Energy",
 *         "volume": 12500000
 *       },
 *       ...
 *     ],
 *     "date": "2026-07-11",
 *     "count": 60
 *   }
 *
 * Notes:
 * - % change uses indicators.closePrev when available.
 * - marketCap is not stored natively; we estimate from market-cap category
 *   midpoints blended with day turnover so treemap tile sizes stay meaningful.
 *   Replace with official free-float mcap once ingestion provides it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { and, desc, eq, max, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/** Typical free-float market-cap midpoints (INR) by category. */
const CATEGORY_BASE_INR: Record<string, number> = {
  large: 5_000_000_000_000, // ₹5T
  mid: 400_000_000_000, // ₹400B
  small: 60_000_000_000, // ₹60B
  micro: 12_000_000_000, // ₹12B
};

/**
 * Estimate market cap (INR) for treemap sizing.
 * Prefer category base; always blend with turnover so liquid names rank correctly.
 */
function estimateMarketCap(
  category: string | null | undefined,
  close: number,
  volume: number,
  avgVol20: number | null | undefined,
): number {
  const vol = avgVol20 && avgVol20 > 0 ? avgVol20 : volume;
  // ~100 days of volume × price — lands large NSE names in the ₹0.1T–₹20T band
  const liquidityProxy = Math.max(close, 1) * Math.max(vol, 1) * 100;
  const base = category ? CATEGORY_BASE_INR[category] : undefined;
  if (base != null) {
    // Geometric blend: category sets the floor, liquidity differentiates within it
    return Math.round(Math.sqrt(base * Math.max(liquidityProxy, base * 0.1)));
  }
  return Math.round(liquidityProxy);
}

function pctChange(close: number, closePrev: number | null | undefined): number {
  if (closePrev == null || closePrev <= 0) return 0;
  return Math.round(((close - closePrev) / closePrev) * 10000) / 100;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(200, Math.max(1, Number(sp.get('limit') ?? 60)));
    let date = sp.get('date') ?? undefined;

    if (!date) {
      const [row] = await db
        .select({ latest: max(schema.eodPrices.date) })
        .from(schema.eodPrices);
      date = row?.latest ?? undefined;
    }

    if (!date) {
      return NextResponse.json({ date: null, count: 0, stocks: [] });
    }

    // Top N by day turnover (close × volume) — liquid names first for the heatmap
    const rows = await db
      .select({
        symbol: schema.eodPrices.ticker,
        name: schema.companies.name,
        sector: schema.companies.sector,
        marketCapCategory: schema.companies.marketCapCategory,
        close: schema.eodPrices.close,
        volume: schema.eodPrices.volume,
        closePrev: schema.indicators.closePrev,
        avgVol20: schema.indicators.avgVol20,
      })
      .from(schema.eodPrices)
      .leftJoin(schema.companies, eq(schema.eodPrices.ticker, schema.companies.ticker))
      .leftJoin(
        schema.indicators,
        and(
          eq(schema.indicators.ticker, schema.eodPrices.ticker),
          eq(schema.indicators.date, schema.eodPrices.date),
        ),
      )
      .where(eq(schema.eodPrices.date, date))
      .orderBy(desc(sql`${schema.eodPrices.close} * ${schema.eodPrices.volume}`))
      .limit(limit);

    const stocks = rows.map(r => ({
      symbol: r.symbol,
      name: r.name ?? r.symbol,
      pctChange: pctChange(r.close, r.closePrev),
      marketCap: estimateMarketCap(r.marketCapCategory, r.close, r.volume, r.avgVol20),
      sector: r.sector ?? 'Unknown',
      volume: r.volume,
    }));

    return NextResponse.json({
      date,
      count: stocks.length,
      stocks,
    });
  } catch (err) {
    console.error('[api/stocks-heatmap] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
