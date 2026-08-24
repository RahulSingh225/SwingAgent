/**
 * NSE fetch helpers for the backfill scripts.
 *
 * NSE gates its JSON APIs behind a browser-like session. Two quirks matter:
 *   1. `https://www.nseindia.com/` itself returns 403 to plain clients — the
 *      cookies have to come from a content page instead.
 *   2. Cookies expire mid-crawl, and the API then returns 401 or an empty body
 *      rather than a clear error, so the session is re-primed on any failure.
 *
 * Archive CSVs (bhavcopy, index closes) are static files and need no session,
 * but they still reject requests without a browser User-Agent and Referer.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.nseindia.com/',
};

/** Cookie jar — node's fetch has none, so Set-Cookie is tracked by hand. */
let cookies = new Map<string, string>();
let primedAt = 0;

const SESSION_TTL_MS = 4 * 60 * 1000;

function absorb(res: Response): void {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) {
      cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }
}

function cookieHeader(): string {
  return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Establish (or refresh) an NSE session. */
export async function primeSession(force = false): Promise<void> {
  if (!force && Date.now() - primedAt < SESSION_TTL_MS && cookies.size > 0) {
    return;
  }
  cookies = new Map();
  // The homepage 403s for non-browsers; content pages still hand out cookies.
  for (const url of [
    'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
    'https://www.nseindia.com/companies-listing/corporate-filings-actions',
  ]) {
    try {
      const res = await fetch(url, {
        headers: { ...BASE_HEADERS, Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(30_000),
      });
      absorb(res);
      await res.arrayBuffer();
    } catch {
      // A single failed prime is survivable — the retry loop re-primes.
    }
    await sleep(400);
  }
  primedAt = Date.now();
}

/**
 * GET a JSON endpoint with session handling and backoff.
 * Returns null when the endpoint yields nothing usable after all attempts.
 */
export async function fetchJson<T>(url: string, attempts = 4): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    await primeSession(i > 0);
    try {
      const res = await fetch(url, {
        headers: {
          ...BASE_HEADERS,
          Accept: 'application/json, text/plain, */*',
          Cookie: cookieHeader(),
        },
        signal: AbortSignal.timeout(90_000),
      });
      absorb(res);
      if (res.status === 401 || res.status === 403) {
        await sleep(1500 * (i + 1));
        continue;
      }
      if (!res.ok) {
        await sleep(1200 * (i + 1));
        continue;
      }
      const text = await res.text();
      if (!text.trim()) {
        await sleep(1200 * (i + 1));
        continue;
      }
      return JSON.parse(text) as T;
    } catch {
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}

/**
 * GET a static archive CSV. Returns null on 404, which for NSE means
 * "market holiday" far more often than it means "broken URL".
 */
export async function fetchCsvText(url: string, attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { ...BASE_HEADERS, Accept: 'text/csv,*/*' },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        await sleep(1000 * (i + 1));
        continue;
      }
      return await res.text();
    } catch {
      await sleep(1200 * (i + 1));
    }
  }
  return null;
}

// ── date helpers ─────────────────────────────────────────

export const pad = (n: number) => String(n).padStart(2, '0');

/** DD-MM-YYYY — the format NSE's JSON APIs expect. */
export const dashDate = (d: Date) =>
  `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;

/** DDMMYYYY — the format NSE's archive filenames use. */
export const stampDate = (d: Date) =>
  `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`;

/** YYYY-MM-DD for Postgres `date` columns. */
export const isoDate = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const addDays = (d: Date, n: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

export const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/** Parse NSE's "15-Jan-2024 23:55:26" / "01-Jan-2024" into a Date (IST → UTC). */
export function parseNseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s
    .trim()
    .match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const mo = months[m[2].toLowerCase()];
  if (mo === undefined) return null;
  // NSE timestamps are IST (UTC+5:30); store as true UTC instants.
  const ms = Date.UTC(
    Number(m[3]), mo, Number(m[1]),
    Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0),
  ) - 5.5 * 3600 * 1000;
  return new Date(ms);
}
