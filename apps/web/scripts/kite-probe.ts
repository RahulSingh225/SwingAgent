/**
 * Probe what Kite will actually serve on THIS subscription.
 *
 * Run this before building anything on top of Kite. Documented limits change and
 * differ by plan; the numbers that matter are the ones your own key returns.
 *
 * It answers four questions:
 *   1. Do the credentials work at all?
 *   2. How far back does history go, per interval?
 *   3. What is the largest window accepted in a single request?
 *   4. How many candles per day come back (sanity: 5-min should be ~75)?
 *
 * The answers determine whether historical intraday can be bought at all, or
 * whether forward capture is the only route — which changes the project timeline
 * by months, so it is worth ten minutes of probing.
 *
 * Usage:
 *   KITE_API_KEY=... KITE_ACCESS_TOKEN=... node scripts/kite-probe.ts [SYMBOL]
 */

import { historical, instrumentsCsv, KiteAuthError, addDaysIso } from './lib/kite.ts';

const INTERVALS = ['5minute', 'minute', 'day'];
/** Look-back distances to test, in days. */
const LOOKBACKS = [30, 90, 200, 400, 800, 1600, 2500];
/** Window sizes to test for a single request, in days. */
const WINDOWS = [7, 30, 60, 100, 200];

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

async function run(): Promise<void> {
  const symbol = (process.argv[2] ?? 'RELIANCE').toUpperCase();

  console.log('[probe] fetching NSE instrument dump …');
  const csv = await instrumentsCsv('NSE');
  if (!csv) {
    console.error('  could not fetch instruments — check connectivity.');
    process.exit(1);
  }
  const lines = csv.split('\n');
  const head = lines[0].split(',');
  const iTok = head.indexOf('instrument_token');
  const iSym = head.indexOf('tradingsymbol');
  const iType = head.indexOf('instrument_type');
  const iSeg = head.indexOf('segment');

  let token: number | null = null;
  let eqCount = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < head.length) continue;
    if (c[iSeg] === 'NSE' && c[iType] === 'EQ') {
      eqCount++;
      if (c[iSym] === symbol) token = Number(c[iTok]);
    }
  }
  console.log(`  ${lines.length - 1} instruments, ${eqCount} NSE equities`);
  if (!token) {
    console.error(`  symbol ${symbol} not found`);
    process.exit(1);
  }
  console.log(`  ${symbol} → instrument_token ${token}\n`);

  // ── how far back does each interval go? ────────────────
  const today = new Date();
  for (const interval of INTERVALS) {
    console.log(`[probe] ${interval} — history depth`);
    let deepest: number | null = null;
    for (const back of LOOKBACKS) {
      const to = new Date(today); to.setUTCDate(to.getUTCDate() - back);
      const from = new Date(to);  from.setUTCDate(from.getUTCDate() - 5);
      try {
        const c = await historical(token, interval, iso(from), iso(to));
        const ok = c !== null && c.length > 0;
        console.log(`  ${String(back).padStart(5)}d ago : ${ok ? `${c!.length} candles` : 'none'}`);
        if (ok) deepest = back;
      } catch (err) {
        if (err instanceof KiteAuthError) { console.error(`\n${err.message}`); process.exit(1); }
        console.log(`  ${String(back).padStart(5)}d ago : error`);
      }
    }
    console.log(`  → deepest confirmed: ${deepest ? `${deepest} days (~${(deepest/365).toFixed(1)}y)` : 'NONE'}\n`);
  }

  // ── largest single-request window for 5minute ──────────
  console.log('[probe] 5minute — max window per request');
  for (const w of WINDOWS) {
    const to = new Date(today); to.setUTCDate(to.getUTCDate() - 10);
    const from = addDaysIso(iso(to), -w);
    try {
      const c = await historical(token, '5minute', from, iso(to));
      const days = w;
      const perDay = c && c.length ? (c.length / (days * 5 / 7)).toFixed(0) : '-';
      console.log(`  ${String(w).padStart(4)}d window : ${c ? `${c.length} candles (~${perDay}/session)` : 'REJECTED'}`);
    } catch (err) {
      if (err instanceof KiteAuthError) { console.error(`\n${err.message}`); process.exit(1); }
      console.log(`  ${String(w).padStart(4)}d window : error`);
    }
  }

  console.log('\n[probe] Interpretation:');
  console.log('  ~75 candles/session for 5minute is correct (09:15-15:30).');
  console.log('  If deep history is unavailable for 5minute, historical backfill is');
  console.log('  impossible and FORWARD CAPTURE becomes the only route — start it');
  console.log('  immediately, because that data cannot be bought later.');
}

run().catch(err => {
  console.error('[probe] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
