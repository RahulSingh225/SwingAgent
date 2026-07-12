/**
 * Catalyst boost — cross-reference candidate tickers with recent high-impact events.
 *
 * If a ticker had an event with impactScore ≥ 6 in the last 5 trading sessions,
 * the candidate's catalyst_event_id is set so the dashboard can highlight it.
 * Catalyst-tagged candidates float to the top.
 */

import { db, schema } from '@/lib/db';
import { gte, desc, inArray, and } from 'drizzle-orm';
import type { CandidateHit } from './setups/types';

export interface BoostedCandidate extends CandidateHit {
  catalystEventId: string | null;
  catalystTitle?: string;
  catalystScore?: number;
}

export async function applyCatalystBoost(
  candidates: CandidateHit[],
): Promise<BoostedCandidate[]> {
  if (candidates.length === 0) return [];

  const tickers = [...new Set(candidates.map(c => c.ticker))];
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

  // Fetch high-impact events for these tickers in the last 5 days
  const recentEvents = await db
    .select({
      id: schema.events.id,
      ticker: schema.events.ticker,
      title: schema.events.title,
      impactScore: schema.events.impactScore,
      publishedAt: schema.events.publishedAt,
    })
    .from(schema.events)
    .where(
      and(
        inArray(schema.events.ticker, tickers),
        gte(schema.events.impactScore, 6),
        gte(schema.events.publishedAt, fiveDaysAgo),
      ),
    )
    .orderBy(desc(schema.events.impactScore));

  // Build ticker → best catalyst map (highest score event per ticker)
  const catalystMap = new Map<
    string,
    { id: string; title: string; score: number }
  >();
  for (const ev of recentEvents) {
    if (ev.ticker && !catalystMap.has(ev.ticker)) {
      catalystMap.set(ev.ticker, {
        id: ev.id,
        title: ev.title,
        score: ev.impactScore,
      });
    }
  }

  // Boost candidates
  const boosted: BoostedCandidate[] = candidates.map(c => {
    const catalyst = catalystMap.get(c.ticker);
    return {
      ...c,
      catalystEventId: catalyst?.id ?? null,
      catalystTitle: catalyst?.title,
      catalystScore: catalyst?.score,
    };
  });

  // Sort: catalyst-tagged first, then by ROC
  boosted.sort((a, b) => {
    const aCat = a.catalystEventId ? 1 : 0;
    const bCat = b.catalystEventId ? 1 : 0;
    if (aCat !== bCat) return bCat - aCat; // catalyst first
    const aRoc = (a.screenValues.roc20 as number) ?? 0;
    const bRoc = (b.screenValues.roc20 as number) ?? 0;
    return bRoc - aRoc; // higher ROC first
  });

  const catalystCount = boosted.filter(c => c.catalystEventId).length;
  console.log(
    `[screener/catalyst-boost] ${catalystCount}/${boosted.length} candidates have catalysts`,
  );

  return boosted;
}
