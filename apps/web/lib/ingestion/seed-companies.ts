/**
 * Seed the `companies` table from NSE's equity master list.
 * Sector + index memberships get enriched later (Phase 3 heatmap drill).
 */

import { parse } from 'csv-parse/sync';
import { db } from '@/lib/db';
import { companies } from '@/lib/db/schema';
import { BROWSER_HEADERS } from './types';

const EQUITY_LIST_URL = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv';

export async function seedCompanies(): Promise<{ seeded: number }> {
  const res = await fetch(EQUITY_LIST_URL, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`EQUITY_L.csv → HTTP ${res.status}`);
  }

  const rows = parse(await res.text(), {
    columns: (header: string[]) => header.map(h => h.trim()),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];

  const companyRows = rows
    .filter(r => (r.SERIES ?? '').trim() === 'EQ' && r.SYMBOL)
    .map(r => ({
      ticker: r.SYMBOL.trim(),
      name: (r['NAME OF COMPANY'] ?? r.SYMBOL).trim(),
    }));

  for (let i = 0; i < companyRows.length; i += 500) {
    await db
      .insert(companies)
      .values(companyRows.slice(i, i + 500))
      .onConflictDoNothing();
  }

  console.log(`[seed-companies] upserted ${companyRows.length} companies`);
  return { seeded: companyRows.length };
}
