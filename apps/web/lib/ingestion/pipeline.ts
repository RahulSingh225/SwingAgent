/**
 * The ingestion pipeline: raw items → dedup → extract → score → store.
 * Only this module produces `MarketEvent` rows — every feed goes through it.
 */

import { createHash } from 'node:crypto';
import {
  calculateClientScore,
  deduplicateItems,
  extractFromText,
  normalizeText,
  normalizeUrl,
  type MarketEvent,
  type OrderValueUnit,
} from '@market-os/intel';
import { db } from '@/lib/db';
import { events } from '@/lib/db/schema';
import type { RawFeedItem } from './types';

function contentId(title: string, link: string): string {
  return createHash('sha256')
    .update(`${normalizeText(title)}|${normalizeUrl(link)}`)
    .digest('hex');
}

function toMarketEvent(item: RawFeedItem): MarketEvent {
  const extraction = extractFromText(item.title, item.snippet);
  const score = calculateClientScore(extraction, item.publishedAt.toISOString());

  return {
    id: contentId(item.title, item.link),
    source: item.source,
    title: item.title,
    link: item.link,
    snippet: item.snippet,
    publishedAt: item.publishedAt.toISOString(),
    ticker: extraction.ticker,
    companyName: extraction.companyName,
    sector: extraction.sector,
    sectorTags: extraction.sectorTags,
    matchedKeywords: extraction.matchedKeywords,
    orderValue: extraction.orderValue,
    orderValueUnit: extraction.orderValueUnit as OrderValueUnit | undefined,
    contractType: extraction.contractType,
    impactScore: score.totalScore,
    scoreDetails: score,
  };
}

/**
 * Run the full pipeline over a batch of raw items.
 * Returns only the events that were actually NEW (freshly inserted) —
 * callers use that for notifications without re-alerting on old items.
 */
export async function processRawItems(items: RawFeedItem[]): Promise<MarketEvent[]> {
  if (items.length === 0) {
    return [];
  }

  // Batch-level dedup (exact URL + fuzzy title); DB-level exact dedup
  // happens via the content-hash primary key below.
  const unique = deduplicateItems(items);
  const marketEvents = unique.map(toMarketEvent);

  const rows = marketEvents.map(e => ({
    id: e.id,
    source: e.source,
    title: e.title,
    link: e.link,
    snippet: e.snippet,
    publishedAt: new Date(e.publishedAt),
    ticker: e.ticker,
    companyName: e.companyName,
    sector: e.sector,
    sectorTags: e.sectorTags,
    matchedKeywords: e.matchedKeywords,
    orderValue: e.orderValue,
    orderValueUnit: e.orderValueUnit,
    contractType: e.contractType,
    impactScore: e.impactScore,
    scoreDetails: e.scoreDetails,
  }));

  const inserted = await db
    .insert(events)
    .values(rows)
    .onConflictDoNothing({ target: events.id })
    .returning({ id: events.id });

  const insertedIds = new Set(inserted.map(r => r.id));
  const fresh = marketEvents.filter(e => insertedIds.has(e.id));

  console.log(
    `[pipeline] ${items.length} raw → ${unique.length} unique → ${fresh.length} new`,
  );
  return fresh;
}
