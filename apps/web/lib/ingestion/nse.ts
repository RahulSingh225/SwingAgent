/**
 * NSE corporate announcements — ported from MarketFeeds, but with plain
 * fetch + cookie warmup instead of Puppeteer (too heavy for a small VPS).
 * NSE's Akamai may still block some IPs; failures are non-fatal and logged.
 */

import { processRawItems } from './pipeline';
import { BROWSER_HEADERS, parseNseDate, type RawFeedItem } from './types';
import type { MarketEvent } from '@market-os/intel';

const NSE_BASE = 'https://www.nseindia.com';

let cookieCache: { cookie: string; fetchedAt: number } | null = null;
const COOKIE_TTL_MS = 5 * 60 * 1000;

/** Warm up an NSE session — the /api endpoints need homepage cookies. */
export async function getNseCookies(): Promise<string> {
  if (cookieCache && Date.now() - cookieCache.fetchedAt < COOKIE_TTL_MS) {
    return cookieCache.cookie;
  }
  const res = await fetch(NSE_BASE, {
    headers: { ...BROWSER_HEADERS, Accept: 'text/html' },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookies.map(c => c.split(';')[0]).join('; ');
  cookieCache = { cookie, fetchedAt: Date.now() };
  return cookie;
}

export async function fetchNseJson<T>(path: string, referer: string): Promise<T> {
  const cookie = await getNseCookies();
  const res = await fetch(`${NSE_BASE}${path}`, {
    headers: {
      ...BROWSER_HEADERS,
      Accept: 'application/json',
      Referer: referer,
      Cookie: cookie,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    throw new Error(`NSE ${path} → HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

interface NseAnnouncement {
  symbol?: string;
  sm_name?: string;
  desc?: string;
  attchmntText?: string;
  attchmntFile?: string;
  an_dt?: string;
}

export async function pollNseAnnouncements(): Promise<MarketEvent[]> {
  try {
    const today = new Date();
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;

    const data = await fetchNseJson<NseAnnouncement[] | { data?: NseAnnouncement[] }>(
      `/api/corporate-announcements?index=equities&from_date=${fmt(today)}&to_date=${fmt(today)}`,
      `${NSE_BASE}/companies-listing/corporate-filings-announcements`,
    );

    const items = Array.isArray(data) ? data : (data.data ?? []);

    const raw: RawFeedItem[] = items.slice(0, 50).map(item => ({
      source: 'nse' as const,
      title: `${item.symbol ?? item.sm_name ?? 'NSE'}: ${item.desc ?? 'Announcement'}`,
      link:
        item.attchmntFile ??
        `${NSE_BASE}/companies-listing/corporate-filings-announcements`,
      snippet: (item.attchmntText ?? '').slice(0, 500),
      publishedAt: (item.an_dt && parseNseDate(item.an_dt)) || new Date(),
    }));

    return processRawItems(raw);
  } catch (err) {
    console.error(
      '[nse] announcements fetch failed (non-fatal):',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
