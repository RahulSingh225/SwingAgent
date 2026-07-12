/**
 * Google Alerts / generic RSS poller over the `feed_sources` table.
 * Feed URLs live in the DB (never in code — they're unauthenticated).
 */

import Parser from 'rss-parser';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { feedSources } from '@/lib/db/schema';
import { processRawItems } from './pipeline';
import { stripHtml, type RawFeedItem } from './types';
import type { MarketEvent, MarketEventSource } from '@market-os/intel';

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketOS/1.0)' },
});

export interface PollResult {
  sourcesPolled: number;
  sourcesFailed: number;
  rawItems: number;
  newEvents: MarketEvent[];
}

export async function pollGoogleAlerts(): Promise<PollResult> {
  const sources = await db
    .select()
    .from(feedSources)
    .where(eq(feedSources.enabled, true));

  const rssSources = sources.filter(
    s => s.type === 'google_alerts' || s.type === 'rss',
  );

  if (rssSources.length === 0) {
    console.log('[google-alerts] no enabled RSS feed_sources — nothing to poll');
    return { sourcesPolled: 0, sourcesFailed: 0, rawItems: 0, newEvents: [] };
  }

  const rawItems: RawFeedItem[] = [];
  const polledIds: number[] = [];
  let failed = 0;

  for (const source of rssSources) {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of feed.items ?? []) {
        rawItems.push({
          source: source.type as MarketEventSource,
          title: stripHtml(item.title ?? ''),
          link: item.link ?? source.url,
          snippet: stripHtml(item.content ?? item.contentSnippet ?? '').slice(0, 500),
          publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
        });
      }
      polledIds.push(source.id);
    } catch (err) {
      failed++;
      console.error(
        `[google-alerts] feed "${source.label}" failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const newEvents = await processRawItems(rawItems.filter(i => i.title));

  if (polledIds.length > 0) {
    await db
      .update(feedSources)
      .set({ lastPolledAt: new Date() })
      .where(inArray(feedSources.id, polledIds));
  }

  return {
    sourcesPolled: polledIds.length,
    sourcesFailed: failed,
    rawItems: rawItems.length,
    newEvents,
  };
}
