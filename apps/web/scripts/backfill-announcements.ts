/**
 * Backfill every NSE corporate announcement into `announcements_raw`.
 *
 * Stored verbatim and unfiltered. The archive is only reachable by scraping,
 * so anything dropped here costs a full re-crawl to recover — classification
 * and filtering happen downstream, reading this table rather than replacing it.
 *
 * NSE's API returns a flat JSON array per date range with no pagination, so the
 * window has to stay small enough that nothing is silently truncated. Windows
 * are checkpointed; an interrupted crawl resumes from where it stopped.
 *
 * Usage: node scripts/backfill-announcements.ts [fromISO] [toISO] [windowDays]
 *   e.g. node scripts/backfill-announcements.ts 2015-01-01 2026-08-04 10
 */

import { sql, checkpoint, doneWindows } from './lib/db.ts';
import { fetchJson, dashDate, isoDate, addDays, parseNseDate, sleep } from './lib/nse.ts';

const JOB = 'announcements';
const API = 'https://www.nseindia.com/api/corporate-announcements';

/**
 * If a window ever returns this many rows, assume NSE truncated the response
 * and the window must be narrowed rather than trusted.
 */
const TRUNCATION_SUSPECT = 9_000;

interface AnnRow {
  symbol?: string;
  sm_name?: string;
  sm_isin?: string;
  desc?: string;
  smIndustry?: string;
  attchmntText?: string;
  attchmntFile?: string;
  an_dt?: string;
  sort_date?: string;
  seq_id?: string | number;
}

async function ingestWindow(from: Date, to: Date): Promise<number | null> {
  const url =
    `${API}?index=equities&from_date=${dashDate(from)}&to_date=${dashDate(to)}`;
  const data = await fetchJson<AnnRow[]>(url);
  if (!Array.isArray(data)) {
    return null;
  }
  if (data.length === 0) {
    return 0;
  }

  // Deduplicate inside the batch — NSE occasionally repeats a seq_id in one
  // response, which would abort the multi-row insert on a PK collision.
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of data) {
    const announcedAt = parseNseDate(r.an_dt) ?? parseNseDate(r.sort_date);
    if (!announcedAt) continue;

    // seq_id is NSE's own stable identifier; fall back to a composite key.
    const seqId =
      r.seq_id != null && String(r.seq_id).trim()
        ? `nse:${String(r.seq_id).trim()}`
        : `nse:${(r.symbol ?? '?').trim()}:${announcedAt.toISOString()}:${(r.desc ?? '').slice(0, 40)}`;

    // Keys are snake_case: postgres.js maps object keys straight to columns.
    byId.set(seqId, {
      seq_id: seqId,
      symbol: (r.symbol ?? '').trim() || null,
      isin: (r.sm_isin ?? '').trim() || null,
      company_name: (r.sm_name ?? '').trim() || null,
      category: (r.desc ?? '').trim() || null,
      sm_industry: (r.smIndustry ?? '').trim() || null,
      announced_at: announcedAt.toISOString(),
      attachment_text: (r.attchmntText ?? '').trim() || null,
      attachment_file: (r.attchmntFile ?? '').trim() || null,
      raw: sql.json(r as Record<string, unknown>),
    });
  }

  const rows = [...byId.values()];
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await sql`
      INSERT INTO announcements_raw ${sql(
        chunk,
        'seq_id', 'symbol', 'isin', 'company_name', 'category',
        'sm_industry', 'announced_at', 'attachment_text', 'attachment_file', 'raw',
      )}
      ON CONFLICT (seq_id) DO NOTHING
    `;
  }
  return data.length;
}

async function run(): Promise<void> {
  const from = new Date(`${process.argv[2] ?? '2015-01-01'}T00:00:00Z`);
  const to = new Date(`${process.argv[3] ?? isoDate(new Date())}T00:00:00Z`);
  const windowDays = Number(process.argv[4] ?? 10);

  const done = await doneWindows(JOB);
  console.log(
    `[${JOB}] ${isoDate(from)} → ${isoDate(to)}, ${windowDays}-day windows ` +
    `(${done.size} already done)`,
  );

  let windows = 0;
  let total = 0;
  const suspect: string[] = [];

  for (let start = from; start <= to; start = addDays(start, windowDays)) {
    const end = addDays(start, windowDays - 1) > to ? to : addDays(start, windowDays - 1);
    const key = `${isoDate(start)}_${isoDate(end)}`;
    if (done.has(key)) continue;

    try {
      const n = await ingestWindow(start, end);
      if (n === null) {
        console.warn(`  ${key}: no response — will retry on rerun`);
        await checkpoint(JOB, key, 0, 'failed', 'null response');
      } else {
        windows++;
        total += n;
        if (n >= TRUNCATION_SUSPECT) {
          suspect.push(key);
          console.warn(`  ${key}: ${n} rows — POSSIBLE TRUNCATION, narrow this window`);
        }
        await checkpoint(JOB, key, n);
        if (windows % 20 === 0) {
          console.log(`  ${key}: ${n} rows — ${windows} windows, ${total} total`);
        }
      }
    } catch (err) {
      console.warn(`  ${key} failed: ${err instanceof Error ? err.message : err}`);
      await checkpoint(JOB, key, 0, 'failed', String(err));
    }
    await sleep(700);
  }

  const [{ count }] = await sql<{ count: string }[]>`
    SELECT count(*) AS count FROM announcements_raw
  `;
  console.log(`[${JOB}] done — ${windows} windows, ${total} fetched, ${count} stored`);
  if (suspect.length) {
    console.warn(`[${JOB}] ${suspect.length} window(s) may be truncated: ${suspect.join(', ')}`);
  }
  await sql.end();
}

run().catch(async err => {
  console.error(`[${JOB}] fatal:`, err);
  await sql.end();
  process.exit(1);
});
