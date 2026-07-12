/**
 * FII/DII cash flows — ported from the fii-dii-data scraper (cash segment
 * only; the F&O OI parts stay in that repo until the dashboard needs them).
 * Runs 19:30 IST after NSE publishes provisional numbers.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { fiiDii } from '@/lib/db/schema';
import { fetchNseJson } from './nse';
import { parseNseDate, isoDate } from './types';

interface FiiDiiRow {
  category?: string;
  date?: string;
  buyValue?: string;
  sellValue?: string;
  netValue?: string;
}

export interface FiiDiiResult {
  date: string;
  fiiNet: number;
  diiNet: number;
}

export async function runFiiDii(): Promise<FiiDiiResult | null> {
  const rows = await fetchNseJson<FiiDiiRow[]>(
    '/api/fiidiiTradeReact',
    'https://www.nseindia.com/reports/fii-dii',
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('[fii-dii] empty response — market may be closed');
    return null;
  }

  const out = { date: '', fiiBuy: 0, fiiSell: 0, diiBuy: 0, diiSell: 0 };

  for (const row of rows) {
    const cat = (row.category ?? '').toUpperCase();
    const buy = parseFloat(row.buyValue ?? '0');
    const sell = parseFloat(row.sellValue ?? '0');
    if (cat.includes('FII') || cat.includes('FPI')) {
      out.fiiBuy = buy;
      out.fiiSell = sell;
      out.date = row.date ?? '';
    } else if (cat.includes('DII')) {
      out.diiBuy = buy;
      out.diiSell = sell;
      out.date ||= row.date ?? '';
    }
  }

  const parsed = out.date ? parseNseDate(out.date) : null;
  if (!parsed) {
    console.warn(`[fii-dii] unparseable date "${out.date}" — skipping`);
    return null;
  }
  const date = isoDate(parsed);

  await db
    .insert(fiiDii)
    .values({ date, fiiBuy: out.fiiBuy, fiiSell: out.fiiSell, diiBuy: out.diiBuy, diiSell: out.diiSell })
    .onConflictDoUpdate({
      target: fiiDii.date,
      set: {
        fiiBuy: sql`excluded.fii_buy`,
        fiiSell: sql`excluded.fii_sell`,
        diiBuy: sql`excluded.dii_buy`,
        diiSell: sql`excluded.dii_sell`,
      },
    });

  const result = {
    date,
    fiiNet: Math.round((out.fiiBuy - out.fiiSell) * 100) / 100,
    diiNet: Math.round((out.diiBuy - out.diiSell) * 100) / 100,
  };
  console.log(`[fii-dii] ${date}: FII net ${result.fiiNet} Cr, DII net ${result.diiNet} Cr`);
  return result;
}
