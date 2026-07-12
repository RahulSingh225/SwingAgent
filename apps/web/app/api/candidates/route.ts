/**
 * GET /api/candidates — today's screener output joined with catalyst events.
 *
 * Query params:
 *   date      — YYYY-MM-DD (default: today IST)
 *   setup     — filter by setup name prefix (e.g. "dma-pullback", "confluence")
 *   direction — "long" | "short" (filter by direction embedded in setup name)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, desc, and, like, inArray, SQL } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/** Return today's date in IST as YYYY-MM-DD */
function todayIST(): string {
  const d = new Date();
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const date = sp.get('date') ?? todayIST();
    const setup = sp.get('setup');       // e.g. "dma-pullback", "confluence"
    const direction = sp.get('direction'); // "long" | "short"

    // Build where conditions
    const conditions: SQL[] = [eq(schema.candidates.date, date)];
    if (setup) {
      conditions.push(like(schema.candidates.setupName, `${setup}%`));
    }
    if (direction) {
      conditions.push(like(schema.candidates.setupName, `%-${direction}@%`));
    }

    // Get candidates for the date, join with companies for the name & sector
    const rows = await db
      .select({
        date: schema.candidates.date,
        ticker: schema.candidates.ticker,
        setupName: schema.candidates.setupName,
        screenValues: schema.candidates.screenValues,
        catalystEventId: schema.candidates.catalystEventId,
        companyName: schema.companies.name,
        sector: schema.companies.sector,
        marketCapCategory: schema.companies.marketCapCategory,
      })
      .from(schema.candidates)
      .leftJoin(schema.companies, eq(schema.candidates.ticker, schema.companies.ticker))
      .where(and(...conditions))
      .orderBy(desc(schema.candidates.date));

    // Fetch catalyst events for candidates that have one
    const catalystIds = [...new Set(
      rows.map(r => r.catalystEventId).filter((id): id is string => id !== null)
    )];

    const catalysts =
      catalystIds.length > 0
        ? await db
            .select({
              id: schema.events.id,
              title: schema.events.title,
              impactScore: schema.events.impactScore,
              aiAnalysis: schema.events.aiAnalysis,
            })
            .from(schema.events)
            .where(inArray(schema.events.id, catalystIds))
        : [];

    // Build a lookup
    const catalystMap = new Map(catalysts.map(c => [c.id, c]));

    const result = rows.map(r => ({
      ...r,
      catalyst: r.catalystEventId ? catalystMap.get(r.catalystEventId) ?? null : null,
    }));

    // Group counts by setup for the summary
    const setupCounts: Record<string, number> = {};
    for (const r of result) {
      setupCounts[r.setupName] = (setupCounts[r.setupName] ?? 0) + 1;
    }

    return NextResponse.json({
      date,
      count: result.length,
      setupCounts,
      candidates: result,
    });
  } catch (err) {
    console.error('[api/candidates] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
