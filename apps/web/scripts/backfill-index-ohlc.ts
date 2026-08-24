/**
 * Backfill open/high/low for every index into `index_prices`.
 *
 * Only `close` was originally stored, which forced the event ledger to measure
 * both legs close-to-close: an open-entry stock leg against a close-entry index
 * leg would bias every excess return by one overnight index move. That was a
 * documented limitation.
 *
 * The wave-fade study enters at the next session's OPEN, so the benchmark needs
 * an open too. The source CSV (`ind_close_all_DDMMYYYY.csv`) has carried these
 * columns all along — they were simply never parsed.
 *
 * Only rows already present are updated; dates are read from `index_prices`
 * itself, so this never re-derives the trading calendar.
 *
 * Usage: node scripts/backfill-index-ohlc.ts
 */

import { sql, checkpoint, doneWindows } from './lib/db.ts';
import { fetchCsvText, stampDate, sleep } from './lib/nse.ts';

const JOB = 'index-ohlc';
const ARCHIVES = 'https://nsearchives.nseindia.com';

function num(v: unknown): number | null {
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

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

async function run(): Promise<void> {
  await sql`ALTER TABLE index_prices ADD COLUMN IF NOT EXISTS open double precision`;
  await sql`ALTER TABLE index_prices ADD COLUMN IF NOT EXISTS high double precision`;
  await sql`ALTER TABLE index_prices ADD COLUMN IF NOT EXISTS low  double precision`;

  const dates = await sql<{ date: string }[]>`
    SELECT DISTINCT date::text AS date FROM index_prices ORDER BY date
  `;
  const done = await doneWindows(JOB);
  console.log(`[${JOB}] ${dates.length} index dates, ${done.size} already done`);

  let updated = 0;
  let missing = 0;

  for (const { date } of dates) {
    if (done.has(date)) continue;
    const stamp = stampDate(new Date(`${date}T00:00:00Z`));
    const text = await fetchCsvText(`${ARCHIVES}/content/indices/ind_close_all_${stamp}.csv`);
    if (!text) {
      missing++;
      await checkpoint(JOB, date, 0, 'failed', 'csv missing');
      await sleep(250);
      continue;
    }

    const rows = parseCsv(text).flatMap(r => {
      const name = (r['Index Name'] ?? '').trim().toUpperCase();
      const open = num(r['Open Index Value']);
      const high = num(r['High Index Value']);
      const low = num(r['Low Index Value']);
      if (!name || open === null) return [];
      return [{ index_name: name, date, open, high, low }];
    });

    // One statement per date, not one per index — a row-at-a-time loop here is
    // ~285k round trips and takes about an hour.
    if (rows.length) {
      await sql`
        UPDATE index_prices ip
        SET open = v.open::double precision,
            high = nullif(v.high, '')::double precision,
            low  = nullif(v.low,  '')::double precision
        FROM (VALUES ${sql(
          rows.map(r => [
            r.index_name, r.date,
            String(r.open), String(r.high ?? ''), String(r.low ?? ''),
          ]),
        )}) AS v(index_name, date, open, high, low)
        WHERE ip.index_name = v.index_name AND ip.date = v.date::date
      `;
    }
    updated += rows.length;
    await checkpoint(JOB, date, rows.length);
    await sleep(250);
  }

  const [{ filled, total }] = await sql<{ filled: string; total: string }[]>`
    SELECT count(open)::text AS filled, count(*)::text AS total FROM index_prices
  `;
  console.log(`[${JOB}] done — ${updated} rows updated, ${missing} dates missing`);
  console.log(`[${JOB}] index_prices now ${filled}/${total} rows with an open`);
  await sql.end();
}

run().catch(async err => {
  console.error(`[${JOB}] fatal:`, err);
  await sql.end();
  process.exit(1);
});
