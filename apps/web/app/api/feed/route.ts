/**
 * GET /api/feed — events feed, filterable by score threshold and date range.
 *
 * Query params:
 *   minScore — minimum impactScore (default 1)
 *   limit    — max rows (default 50, cap 200)
 *   before   — ISO timestamp, events published before this
 *   after    — ISO timestamp, events published after this
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { desc, gte, lte, and, SQL } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const minScore = Math.max(1, Number(sp.get('minScore') ?? 1));
    const limit = Math.min(200, Math.max(1, Number(sp.get('limit') ?? 50)));
    const before = sp.get('before');
    const after = sp.get('after');

    const conditions: SQL[] = [gte(schema.events.impactScore, minScore)];
    if (before) conditions.push(lte(schema.events.publishedAt, new Date(before)));
    if (after) conditions.push(gte(schema.events.publishedAt, new Date(after)));

    const rows = await db
      .select()
      .from(schema.events)
      .where(and(...conditions))
      .orderBy(desc(schema.events.publishedAt))
      .limit(limit);

    return NextResponse.json({ count: rows.length, events: rows });
  } catch (err) {
    console.error('[api/feed] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
