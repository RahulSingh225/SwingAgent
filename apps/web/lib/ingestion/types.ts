import type { MarketEventSource } from '@market-os/intel';

/** Normalized raw item from any feed, before the intel pipeline runs. */
export interface RawFeedItem {
  source: MarketEventSource;
  title: string;
  link: string;
  snippet: string;
  publishedAt: Date;
}

/** Shared browser-like headers — NSE/BSE endpoints reject default UAs. */
export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.5',
} as const;

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse NSE-style "11-Jul-2026" / "11-Jul-2026 19:23:45" timestamps as IST.
 * Returns null on anything unparseable.
 */
export function parseNseDate(value: string): Date | null {
  const m = value
    .trim()
    .match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) {
    return null;
  }
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) {
    return null;
  }
  const [hh, mm, ss] = [m[4] ?? '00', m[5] ?? '00', m[6] ?? '00'];
  // Interpret as IST (+05:30)
  const iso = `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}T${hh}:${mm}:${ss}+05:30`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** DDMMYYYY used by NSE archive file names, in IST. */
export function ddmmyyyy(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}${mm}${ist.getUTCFullYear()}`;
}

/** YYYY-MM-DD (Postgres date) in IST. */
export function isoDate(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}
