/**
 * GET /api/dashboard — aggregated data for the top strip + sector heatmap.
 *
 * Returns the latest FII/DII, sector snapshots, and market breadth
 * in a single request so the dashboard renders in one roundtrip.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { desc, eq, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Latest date in sector_snapshot
    const latestSectorRow = await db
      .select({ date: schema.sectorSnapshot.date })
      .from(schema.sectorSnapshot)
      .orderBy(desc(schema.sectorSnapshot.date))
      .limit(1);
    const sectorDate = latestSectorRow[0]?.date;

    // Sector snapshot for the latest date
    const sectors = sectorDate
      ? await db
          .select()
          .from(schema.sectorSnapshot)
          .where(eq(schema.sectorSnapshot.date, sectorDate))
      : [];

    // Latest FII/DII row
    const fiiDiiRows = await db
      .select()
      .from(schema.fiiDii)
      .orderBy(desc(schema.fiiDii.date))
      .limit(1);
    const fiiDii = fiiDiiRows[0] ?? null;

    // Broad market breadth — aggregate advance/decline from sector_snapshot
    const breadth = sectors.reduce(
      (acc, s) => ({
        advance: acc.advance + (s.advance ?? 0),
        decline: acc.decline + (s.decline ?? 0),
      }),
      { advance: 0, decline: 0 },
    );

    // Key index returns (Nifty 50, Nifty Bank, Nifty Midcap 150)
    const keyIndices = ['NIFTY 50', 'NIFTY BANK', 'NIFTY MIDCAP 150'];
    const indices = sectorDate
      ? await db
          .select()
          .from(schema.sectorSnapshot)
          .where(
            sql`${schema.sectorSnapshot.date} = ${sectorDate} AND ${schema.sectorSnapshot.indexName} IN (${sql.join(
              keyIndices.map(i => sql`${i}`),
              sql`, `,
            )})`,
          )
      : [];

    return NextResponse.json({
      date: sectorDate ?? null,
      indices,
      sectors,
      fiiDii,
      breadth,
    });
  } catch (err) {
    console.error('[api/dashboard] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
