/**
 * Screener runner — nightly orchestrator (19:45 IST).
 *
 * 1. Fetch the ROC universe (top 100 stocks by ROC20)
 * 2. Run each entry screener (both long & short) across the universe
 * 3. Apply catalyst boost (cross-ref with recent high-impact events)
 * 4. Insert results into the `candidates` table
 */

import { db, schema } from '@/lib/db';
import { eq, sql, max } from 'drizzle-orm';
import { getUniverse } from './universe';
import { dmaPullback } from './setups/dma-pullback';
import { rsiReaction } from './setups/rsi-reaction';
import { stochReaction } from './setups/stoch-reaction';
import { confluence } from './setups/confluence';
import { applyCatalystBoost } from './catalyst-boost';
import type { CandidateHit, SetupDirection } from './setups/types';

/** Return today's date in IST as YYYY-MM-DD */
function todayIST(): string {
  const d = new Date();
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

/** All setup functions to run */
const SETUPS: Array<{ name: string; fn: (universe: any[], dir: SetupDirection) => CandidateHit[] }> = [
  { name: 'dma-pullback', fn: dmaPullback },
  { name: 'rsi-reaction', fn: rsiReaction },
  { name: 'stoch-reaction', fn: stochReaction },
  { name: 'confluence', fn: confluence },
];

export interface ScreenerResult {
  date: string;
  universeSize: number;
  totalCandidates: number;
  catalystBoosted: number;
  bySetup: Record<string, number>;
}

export async function runScreenerPipeline(): Promise<ScreenerResult> {
  const date = todayIST();

  // Use the latest available indicator date (may differ from IST today if data isn't in yet)
  const [row] = await db
    .select({ latest: max(schema.indicators.date) })
    .from(schema.indicators);
  const indicatorDate = row?.latest;

  if (!indicatorDate) {
    console.warn('[screener] no indicator data — skipping');
    return { date, universeSize: 0, totalCandidates: 0, catalystBoosted: 0, bySetup: {} };
  }

  console.log(`[screener] running for date=${date}, indicators from ${indicatorDate}`);

  // 1. Universe
  const universe = await getUniverse({ topN: 100, date: indicatorDate });
  console.log(`[screener] universe: ${universe.length} stocks (top 100 by ROC20)`);

  // 2. Run all setups (both directions)
  const allHits: CandidateHit[] = [];
  const bySetup: Record<string, number> = {};

  for (const { fn } of SETUPS) {
    for (const dir of ['long', 'short'] as SetupDirection[]) {
      const hits = fn(universe, dir);
      allHits.push(...hits);
      for (const h of hits) {
        bySetup[h.setupName] = (bySetup[h.setupName] ?? 0) + 1;
      }
    }
  }

  console.log(`[screener] ${allHits.length} raw candidates across ${Object.keys(bySetup).length} setups`);

  // 3. Catalyst boost
  const boosted = await applyCatalystBoost(allHits);
  const catalystBoosted = boosted.filter(c => c.catalystEventId).length;

  // 4. Insert into candidates table (upsert by date + ticker + setup_name)
  if (boosted.length > 0) {
    // Clear today's old candidates first (so re-runs don't accumulate)
    await db
      .delete(schema.candidates)
      .where(eq(schema.candidates.date, date));

    const rows = boosted.map(c => ({
      date,
      ticker: c.ticker,
      setupName: c.setupName,
      screenValues: c.screenValues,
      catalystEventId: c.catalystEventId,
    }));

    for (let i = 0; i < rows.length; i += 500) {
      await db
        .insert(schema.candidates)
        .values(rows.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [schema.candidates.date, schema.candidates.ticker, schema.candidates.setupName],
          set: {
            screenValues: sql`excluded.screen_values`,
            catalystEventId: sql`excluded.catalyst_event_id`,
          },
        });
    }
  }

  console.log(`[screener] wrote ${boosted.length} candidates for ${date}`);

  return {
    date,
    universeSize: universe.length,
    totalCandidates: boosted.length,
    catalystBoosted,
    bySetup,
  };
}
