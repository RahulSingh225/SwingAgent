/**
 * Backfill EOD equity prices and index closes.
 *
 * Two archives, one per trading day:
 *   sec_bhavdata_full_DDMMYYYY.csv — OHLCV + delivery %, available from ~Sep 2019
 *   ind_close_all_DDMMYYYY.csv     — closing level of every NSE index
 *
 * Index CLOSES (not just % change) are what make benchmark-relative returns
 * possible: chaining rounded daily percentages across a 10-day window drifts,
 * and the whole point of the ledger is that its return numbers are trustworthy.
 *
 * A 404 means market holiday, which is the common case and not an error.
 * Every day is checkpointed, so an interrupted crawl resumes where it stopped.
 *
 * Usage: node scripts/backfill-prices.ts <fromISO> <toISO>
 *   e.g. node scripts/backfill-prices.ts 2019-09-01 2026-08-04
 */

import { sql, checkpoint, doneWindows } from './lib/db.ts';
import { fetchCsvText, stampDate, isoDate, addDays, isWeekend, sleep } from './lib/nse.ts';

const JOB = 'prices';
const ARCHIVES = 'https://nsearchives.nseindia.com';

function num(v: unknown): number | null {
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/** Minimal CSV split — NSE archive files are unquoted. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map(h => h.trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length < head.length) continue;
    const row: Record<string, string> = {};
    head.forEach((h, j) => (row[h] = (cells[j] ?? '').trim()));
    out.push(row);
  }
  return out;
}

async function ingestDay(day: Date): Promise<{ prices: number; indices: number } | null> {
  const stamp = stampDate(day);
  const date = isoDate(day);

  const bhavText = await fetchCsvText(
    `${ARCHIVES}/products/content/sec_bhavdata_full_${stamp}.csv`,
  );
  if (!bhavText) {
    return null; // holiday
  }

  const rows = parseCsv(bhavText).filter(r => (r.SERIES ?? '').trim() === 'EQ');
  const priceRows = rows.flatMap(r => {
    const open = num(r.OPEN_PRICE);
    const high = num(r.HIGH_PRICE);
    const low = num(r.LOW_PRICE);
    const close = num(r.CLOSE_PRICE);
    const volume = num(r.TTL_TRD_QNTY);
    const ticker = (r.SYMBOL ?? '').trim();
    if (!ticker || open === null || high === null || low === null || close === null || volume === null) {
      return [];
    }
    // Keys are snake_case: postgres.js maps object keys straight to columns.
    return [{
      ticker, date, open, high, low, close,
      volume: Math.round(volume),
      delivery_pct: num(r.DELIV_PER),
    }];
  });

  for (let i = 0; i < priceRows.length; i += 1000) {
    const chunk = priceRows.slice(i, i + 1000);
    await sql`
      INSERT INTO eod_prices ${sql(chunk, 'ticker', 'date', 'open', 'high', 'low', 'close', 'volume', 'delivery_pct')}
      ON CONFLICT (ticker, date) DO NOTHING
    `;
  }

  // Index closes — tolerate absence rather than losing the equity rows.
  let indexCount = 0;
  const idxText = await fetchCsvText(`${ARCHIVES}/content/indices/ind_close_all_${stamp}.csv`);
  if (idxText) {
    const idxRows = parseCsv(idxText).flatMap(r => {
      const name = (r['Index Name'] ?? '').trim().toUpperCase();
      const close = num(r['Closing Index Value']);
      if (!name || close === null) return [];
      return [{ index_name: name, date, close, pct_change: num(r['Change(%)']) }];
    });
    indexCount = idxRows.length;
    for (let i = 0; i < idxRows.length; i += 500) {
      const chunk = idxRows.slice(i, i + 500);
      await sql`
        INSERT INTO index_prices ${sql(chunk, 'index_name', 'date', 'close', 'pct_change')}
        ON CONFLICT (index_name, date) DO UPDATE SET close = excluded.close, pct_change = excluded.pct_change
      `;
    }
  }

  return { prices: priceRows.length, indices: indexCount };
}

async function run(): Promise<void> {
  const from = new Date(`${process.argv[2] ?? '2019-09-01'}T00:00:00Z`);
  const to = new Date(`${process.argv[3] ?? isoDate(new Date())}T00:00:00Z`);

  const done = await doneWindows(JOB);
  console.log(`[${JOB}] ${isoDate(from)} → ${isoDate(to)} (${done.size} days already done)`);

  let days = 0;
  let holidays = 0;
  let totalPrices = 0;

  for (let d = from; d <= to; d = addDays(d, 1)) {
    const key = isoDate(d);
    if (isWeekend(d) || done.has(key)) continue;

    try {
      const res = await ingestDay(d);
      if (!res) {
        holidays++;
        await checkpoint(JOB, key, 0, 'done', 'holiday');
      } else {
        days++;
        totalPrices += res.prices;
        await checkpoint(JOB, key, res.prices);
        if (days % 25 === 0) {
          console.log(`  ${key}: ${res.prices} prices, ${res.indices} indices — ${days} days, ${totalPrices} rows so far`);
        }
      }
    } catch (err) {
      console.warn(`  ${key} failed: ${err instanceof Error ? err.message : err}`);
      await checkpoint(JOB, key, 0, 'failed', String(err));
    }
    await sleep(350);
  }

  console.log(`[${JOB}] done — ${days} trading days, ${holidays} holidays, ${totalPrices} price rows`);
  await sql.end();
}

run().catch(async err => {
  console.error(`[${JOB}] fatal:`, err);
  await sql.end();
  process.exit(1);
});
