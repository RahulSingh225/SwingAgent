/**
 * GET /api/brief/latest — returns the most recent AI evening brief.
 */

import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [brief] = await db
      .select()
      .from(schema.briefs)
      .orderBy(desc(schema.briefs.date))
      .limit(1);

    if (!brief) {
      return NextResponse.json({ brief: null, message: 'No briefs generated yet.' });
    }

    return NextResponse.json({ brief });
  } catch (err) {
    console.error('[api/brief/latest] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
