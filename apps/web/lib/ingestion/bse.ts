/**
 * BSE corporate announcements — ported from MarketFeeds (API variant only;
 * the HTML-scraper fallback needed Puppeteer and is deliberately dropped).
 * BSE's API generally works with a browser UA + Referer.
 */

import { processRawItems } from './pipeline';
import { BROWSER_HEADERS, type RawFeedItem } from './types';
import type { MarketEvent } from '@market-os/intel';

const BSE_API = 'https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w';

interface BseAnnouncement {
  NEWSSUB?: string;
  HEADLINE?: string;
  NSURL?: string;
  ATTACHMENTNAME?: string;
  NEWS_DT?: string;
  SLONGNAME?: string;
  SCRIP_CD?: string;
}

export async function pollBseAnnouncements(): Promise<MarketEvent[]> {
  try {
    const today = new Date();
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`;

    const params = new URLSearchParams({
      strCat: '-1',
      strPrevDate: fmt(today),
      strScrip: '',
      strSearch: 'P',
      strToDate: fmt(today),
      strType: 'C',
    });

    const res = await fetch(`${BSE_API}?${params}`, {
      headers: {
        ...BROWSER_HEADERS,
        Accept: 'application/json',
        Referer: 'https://www.bseindia.com/',
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      throw new Error(`BSE API → HTTP ${res.status}`);
    }

    const data = (await res.json()) as { Table?: BseAnnouncement[] };
    const table = data.Table ?? [];

    const raw: RawFeedItem[] = table.slice(0, 50).map(item => ({
      source: 'bse' as const,
      title: `${item.SLONGNAME ?? 'BSE'}: ${item.NEWSSUB ?? item.HEADLINE ?? 'Announcement'}`,
      link: item.ATTACHMENTNAME
        ? `https://www.bseindia.com/xml-data/corpfiling/AttachHis/${item.ATTACHMENTNAME}`
        : 'https://www.bseindia.com/corporates/ann.html',
      snippet: (item.HEADLINE ?? '').slice(0, 500),
      publishedAt: item.NEWS_DT ? new Date(item.NEWS_DT) : new Date(),
    }));

    return processRawItems(raw);
  } catch (err) {
    console.error(
      '[bse] announcements fetch failed (non-fatal):',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
