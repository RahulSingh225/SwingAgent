/**
 * Kite Connect client for intraday ingestion.
 *
 * Three constraints shape everything here:
 *
 * 1. ACCESS TOKENS EXPIRE DAILY. Kite's access token dies every morning (~06:00
 *    IST); only the api_key/api_secret are durable. An unattended backfill must
 *    therefore fail loudly and early on 403 rather than silently write nothing —
 *    the recurring failure mode in this project has been pipelines that stopped
 *    without anyone noticing.
 *
 * 2. HISTORICAL REQUESTS ARE WINDOW-CAPPED. Each interval allows only a limited
 *    span per request (Kite documents roughly 60 days for `minute`, more for
 *    coarser intervals — VERIFY with kite-probe.ts against your own subscription
 *    rather than trusting a constant here, since the limits change).
 *
 * 3. RATE LIMIT ~3 requests/second on the historical endpoint. A 700-ticker
 *    backfill is tens of thousands of requests, so pacing is not optional.
 *
 * Credentials come from the environment, never from code:
 *   KITE_API_KEY, KITE_ACCESS_TOKEN
 */

const BASE = 'https://api.kite.trade';

/** Kite historical API allows ~3 req/s; stay under it. */
const MIN_REQUEST_GAP_MS = 350;
let lastRequestAt = 0;

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function creds(): { apiKey: string; accessToken: string } {
  const apiKey = process.env.KITE_API_KEY;
  const accessToken = process.env.KITE_ACCESS_TOKEN;
  if (!apiKey || !accessToken) {
    throw new Error(
      'KITE_API_KEY and KITE_ACCESS_TOKEN must be set.\n' +
      'The access token expires daily — regenerate it via the Kite login flow ' +
      'and export it before running any ingestion.',
    );
  }
  return { apiKey, accessToken };
}

async function paced(): Promise<void> {
  const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

export class KiteAuthError extends Error {}

async function kiteGet<T>(path: string, attempts = 3): Promise<T | null> {
  const { apiKey, accessToken } = creds();
  for (let i = 0; i < attempts; i++) {
    await paced();
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: {
          'X-Kite-Version': '3',
          Authorization: `token ${apiKey}:${accessToken}`,
        },
        signal: AbortSignal.timeout(45_000),
      });

      // Fail fast and loudly — a stale token must not look like "no data".
      if (res.status === 403) {
        throw new KiteAuthError(
          'Kite returned 403 — the access token has expired or is invalid. ' +
          'Regenerate it and re-run; the backfill resumes from its checkpoint.',
        );
      }
      if (res.status === 429) {
        await sleep(2000 * (i + 1));
        continue;
      }
      if (!res.ok) {
        // 400 on historical usually means "window too large" or "no data" —
        // surface the body so the caller can distinguish.
        const body = await res.text();
        if (i === attempts - 1) {
          console.warn(`  kite ${res.status}: ${body.slice(0, 160)}`);
        }
        await sleep(800 * (i + 1));
        continue;
      }
      const json = (await res.json()) as { status: string; data: T };
      return json.data;
    } catch (err) {
      if (err instanceof KiteAuthError) throw err;
      await sleep(1000 * (i + 1));
    }
  }
  return null;
}

/** One OHLCV candle as Kite returns it: [ts, o, h, l, c, v]. */
export type RawCandle = [string, number, number, number, number, number];

export interface Candle {
  ts: string;      // ISO timestamp with IST offset, as returned
  open: number; high: number; low: number; close: number; volume: number;
}

/**
 * Fetch historical candles for one instrument over one window.
 * `from`/`to` are 'YYYY-MM-DD' (Kite also accepts datetime; date is enough here).
 */
export async function historical(
  instrumentToken: number,
  interval: string,
  from: string,
  to: string,
): Promise<Candle[] | null> {
  const data = await kiteGet<{ candles: RawCandle[] }>(
    `/instruments/historical/${instrumentToken}/${interval}` +
    `?from=${from}&to=${to}`,
  );
  if (!data?.candles) return null;
  return data.candles.map(c => ({
    ts: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5],
  }));
}

/**
 * The full instrument dump (CSV, not JSON, and unauthenticated).
 * Needed because historical data is keyed on instrument_token, not symbol.
 */
export async function instrumentsCsv(exchange = 'NSE'): Promise<string | null> {
  await paced();
  const res = await fetch(`${BASE}/instruments/${exchange}`, {
    headers: { 'X-Kite-Version': '3' },
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    console.warn(`[kite] instruments ${exchange} → HTTP ${res.status}`);
    return null;
  }
  return res.text();
}

/** Add days to a 'YYYY-MM-DD' string. */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
