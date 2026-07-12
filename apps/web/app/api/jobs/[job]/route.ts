/**
 * Manual job trigger — runs a handler directly (bypasses the queue).
 *   POST /api/jobs/poll-feeds
 *   POST /api/jobs/bhavcopy?backfill=60
 *   POST /api/jobs/fii-dii · seed-companies · screener · evening-brief
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  runBhavcopyJob,
  runEveningBrief,
  runFiiDiiJob,
  runPollFeeds,
  runScreener,
  runSeedCompanies,
} from '@/lib/jobs/handlers';

export const maxDuration = 600;

const RUNNERS: Record<string, (req: NextRequest) => Promise<unknown>> = {
  'poll-feeds': () => runPollFeeds(),
  bhavcopy: req => {
    const backfill = Number(req.nextUrl.searchParams.get('backfill') ?? '');
    return runBhavcopyJob(Number.isFinite(backfill) && backfill > 0 ? backfill : undefined);
  },
  'fii-dii': () => runFiiDiiJob(),
  'seed-companies': () => runSeedCompanies(),
  screener: () => runScreener(),
  'evening-brief': () => runEveningBrief(),
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ job: string }> },
) {
  const { job } = await params;
  const runner = RUNNERS[job];
  if (!runner) {
    return NextResponse.json(
      { error: `unknown job "${job}"`, available: Object.keys(RUNNERS) },
      { status: 404 },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await runner(req);
    return NextResponse.json({ job, ms: Date.now() - startedAt, result });
  } catch (err) {
    console.error(`[api/jobs] ${job} failed:`, err);
    return NextResponse.json(
      { job, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
