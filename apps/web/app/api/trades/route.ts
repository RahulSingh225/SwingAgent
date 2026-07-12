/**
 * /api/trades — CRUD for the trade journal.
 *
 * GET    — list trades (open first, then recently closed)
 * POST   — create a new trade entry
 * PATCH  — close a trade (exit price → compute R-multiple)
 * DELETE — delete a trade by id
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { desc, eq, isNull, isNotNull, sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

// ── GET ──────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get('status'); // open | closed | all (default)
    const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? 100)));

    let whereClause;
    if (status === 'open') whereClause = isNull(schema.trades.closedAt);
    else if (status === 'closed') whereClause = isNotNull(schema.trades.closedAt);

    const rows = await db
      .select()
      .from(schema.trades)
      .where(whereClause)
      .orderBy(
        // Open trades first, then most recently closed
        sql`${schema.trades.closedAt} IS NULL DESC`,
        desc(schema.trades.openedAt),
      )
      .limit(limit);

    // Stats
    const openTrades = rows.filter(t => !t.closedAt);
    const closedTrades = rows.filter(t => t.closedAt);
    const avgR =
      closedTrades.length > 0
        ? closedTrades.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0) / closedTrades.length
        : null;
    const winRate =
      closedTrades.length > 0
        ? closedTrades.filter(t => (t.rMultiple ?? 0) > 0).length / closedTrades.length
        : null;

    return NextResponse.json({
      count: rows.length,
      openCount: openTrades.length,
      closedCount: closedTrades.length,
      avgRMultiple: avgR ? Number(avgR.toFixed(2)) : null,
      winRate: winRate ? Number((winRate * 100).toFixed(1)) : null,
      trades: rows,
    });
  } catch (err) {
    console.error('[api/trades] GET error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ── POST ─────────────────────────────────────────────────

interface CreateTradeBody {
  ticker: string;
  direction: 'long' | 'short';
  entry: number;
  stop: number;
  target?: number;
  qty: number;
  thesis: string;
  setupName?: string;
  catalystEventId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateTradeBody;

    // Validate required fields
    if (!body.ticker || !body.direction || !body.entry || !body.stop || !body.qty || !body.thesis) {
      return NextResponse.json(
        { error: 'Missing required fields: ticker, direction, entry, stop, qty, thesis' },
        { status: 400 },
      );
    }

    const [trade] = await db
      .insert(schema.trades)
      .values({
        ticker: body.ticker.toUpperCase(),
        direction: body.direction,
        entry: body.entry,
        stop: body.stop,
        target: body.target,
        qty: body.qty,
        thesis: body.thesis,
        setupName: body.setupName,
        catalystEventId: body.catalystEventId,
      })
      .returning();

    return NextResponse.json(trade, { status: 201 });
  } catch (err) {
    console.error('[api/trades] POST error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ── PATCH ────────────────────────────────────────────────

interface CloseTradeBody {
  id: number;
  exitPrice: number;
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as CloseTradeBody;

    if (!body.id || !body.exitPrice) {
      return NextResponse.json({ error: 'Missing required fields: id, exitPrice' }, { status: 400 });
    }

    // Fetch the trade to compute R-multiple
    const [existing] = await db
      .select()
      .from(schema.trades)
      .where(eq(schema.trades.id, body.id));

    if (!existing) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    if (existing.closedAt) {
      return NextResponse.json({ error: 'Trade already closed' }, { status: 400 });
    }

    // R-multiple = (exit - entry) / (entry - stop) for longs
    // R-multiple = (entry - exit) / (stop - entry) for shorts
    const risk = Math.abs(existing.entry - existing.stop);
    const pnl =
      existing.direction === 'long'
        ? body.exitPrice - existing.entry
        : existing.entry - body.exitPrice;
    const rMultiple = risk > 0 ? Number((pnl / risk).toFixed(2)) : 0;

    const [updated] = await db
      .update(schema.trades)
      .set({
        exitPrice: body.exitPrice,
        closedAt: new Date(),
        rMultiple,
      })
      .where(eq(schema.trades.id, body.id))
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    console.error('[api/trades] PATCH error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ── DELETE ───────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const id = Number(req.nextUrl.searchParams.get('id'));
    if (!id) {
      return NextResponse.json({ error: 'Missing required param: id' }, { status: 400 });
    }

    const [deleted] = await db
      .delete(schema.trades)
      .where(eq(schema.trades.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    console.error('[api/trades] DELETE error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
