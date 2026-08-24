/**
 * Backfill NSE corporate actions and derive price-adjustment factors.
 *
 * Without this, a 1:1 bonus reads as a 50% single-day crash and a 10→1 split
 * as a 90% one. Those artifacts would dominate any forward-return study, so
 * this has to land before the ledger computes anything.
 *
 * `adjFactor` multiplies every bar strictly BEFORE `exDate`:
 *   Bonus a:b        → b / (a + b)     (1:1 → 0.5, 3:1 → 0.25)
 *   Split FV x → y   → y / x           (Rs10 → Re1 → 0.1)
 *   Consolidation    → same ratio, but > 1 (Re1 → Rs10 → 10)
 *
 * Dividends are stored for reference and never adjusted for — the ledger
 * measures price return, not total return.
 *
 * Usage: node scripts/backfill-corp-actions.ts [fromYear] [toYear]
 */

import { sql, checkpoint, doneWindows } from './lib/db.ts';
import { fetchJson, dashDate, isoDate, addDays, parseNseDate, sleep } from './lib/nse.ts';

const JOB = 'corp-actions';
const API = 'https://www.nseindia.com/api/corporates-corporateActions';

interface CaRow {
  symbol?: string;
  comp?: string;
  series?: string;
  isin?: string;
  subject?: string;
  exDate?: string;
  recDate?: string;
  faceVal?: string;
}

export interface ParsedAction {
  actionType: 'split' | 'bonus' | 'consolidation' | 'dividend' | 'other';
  adjFactor: number | null;
}

/**
 * Classify a corporate-action subject line and derive its price factor.
 * Exported so the unit test can pin the arithmetic.
 */
export function parseAction(subjectRaw: string): ParsedAction {
  const s = (subjectRaw ?? '').replace(/\s+/g, ' ').trim();

  // "Bonus 3:1" / "Bonus Issue 1:1" — a new shares for every b held.
  const bonus = s.match(/bonus\D{0,20}(\d+)\s*:\s*(\d+)/i);
  if (bonus) {
    const a = Number(bonus[1]);
    const b = Number(bonus[2]);
    if (a > 0 && b > 0) {
      return { actionType: 'bonus', adjFactor: b / (a + b) };
    }
    return { actionType: 'bonus', adjFactor: null };
  }

  // "Face Value Split (Sub-Division) - From Rs10/- Per Share To Re 1/- Per Share"
  // Also covers consolidation, which uses the same phrasing in reverse.
  const fv = s.match(
    /from\s*(?:rs|re)?\.?\s*([\d.]+)\s*\/?-?\s*(?:per share)?\s*to\s*(?:rs|re)?\.?\s*([\d.]+)/i,
  );
  if (fv) {
    const from = Number(fv[1]);
    const to = Number(fv[2]);
    if (from > 0 && to > 0) {
      const isConsolidation = /consolidat/i.test(s) || to > from;
      return {
        actionType: isConsolidation ? 'consolidation' : 'split',
        adjFactor: to / from,
      };
    }
  }

  if (/split|sub-?division/i.test(s)) {
    return { actionType: 'split', adjFactor: null };
  }
  if (/consolidat/i.test(s)) {
    return { actionType: 'consolidation', adjFactor: null };
  }
  if (/dividend/i.test(s)) {
    return { actionType: 'dividend', adjFactor: null };
  }
  return { actionType: 'other', adjFactor: null };
}

async function run(): Promise<void> {
  const fromYear = Number(process.argv[2] ?? 2015);
  const toYear = Number(process.argv[3] ?? new Date().getUTCFullYear());

  const done = await doneWindows(JOB);
  console.log(`[${JOB}] ${fromYear}..${toYear} — ${done.size} windows already done`);

  let totalRows = 0;
  let totalAdj = 0;

  // Quarterly windows: the API caps long ranges, and quarters keep payloads small.
  for (let y = fromYear; y <= toYear; y++) {
    for (let q = 0; q < 4; q++) {
      const start = new Date(Date.UTC(y, q * 3, 1));
      const end = addDays(new Date(Date.UTC(y, q * 3 + 3, 1)), -1);
      if (start > new Date()) break;

      const key = `${y}Q${q + 1}`;
      if (done.has(key)) continue;

      const url =
        `${API}?index=equities&from_date=${dashDate(start)}&to_date=${dashDate(end)}`;
      const data = await fetchJson<CaRow[]>(url);

      if (!Array.isArray(data)) {
        console.warn(`  ${key}: no data (skipped, will retry on rerun)`);
        await checkpoint(JOB, key, 0, 'failed', 'null or non-array response');
        await sleep(1200);
        continue;
      }

      let inserted = 0;
      let adjCount = 0;

      for (const r of data) {
        const ticker = (r.symbol ?? '').trim();
        const ex = parseNseDate(r.exDate);
        const subject = (r.subject ?? '').trim();
        // An action with no ex-date cannot be applied to a price series.
        if (!ticker || !ex || !subject) continue;

        const { actionType, adjFactor } = parseAction(subject);
        if (adjFactor !== null) adjCount++;

        await sql`
          INSERT INTO corporate_actions (ticker, ex_date, subject, action_type, adj_factor, raw)
          VALUES (${ticker}, ${isoDate(ex)}, ${subject}, ${actionType},
                  ${adjFactor}, ${sql.json(r as Record<string, unknown>)})
          ON CONFLICT DO NOTHING
        `;
        inserted++;
      }

      totalRows += inserted;
      totalAdj += adjCount;
      await checkpoint(JOB, key, inserted);
      console.log(`  ${key}: ${inserted} actions (${adjCount} with adj factor)`);
      await sleep(900);
    }
  }

  console.log(`[${JOB}] done — ${totalRows} actions, ${totalAdj} adjustable`);
  await sql.end();
}

// Only run when invoked directly, so the parser can be imported by tests.
if (import.meta.filename === process.argv[1]) {
  run().catch(async err => {
    console.error(`[${JOB}] fatal:`, err);
    await sql.end();
    process.exit(1);
  });
}
