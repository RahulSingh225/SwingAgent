/**
 * TopStrip — five numbers, three seconds.
 *
 * Nifty 50 %, BankNifty %, Midcap150 %, Advance/Decline, FII & DII net.
 * Server component — fetches directly from DB.
 */

import { db, schema } from '@/lib/db';
import { desc, eq } from 'drizzle-orm';

interface IndexData {
  indexName: string;
  pctChange: number;
}

interface FiiDiiData {
  fiiBuy: number | null;
  fiiSell: number | null;
  diiBuy: number | null;
  diiSell: number | null;
}

function formatPct(val: number | null | undefined): string {
  if (val == null) return '—';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

function formatCr(val: number | null | undefined): string {
  if (val == null) return '—';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${Math.round(val).toLocaleString('en-IN')} Cr`;
}

function pctColor(val: number | null | undefined): string {
  if (val == null) return '';
  return val >= 0 ? 'text-bullish' : 'text-bearish';
}

export default async function TopStrip() {
  // Latest sector snapshot date
  const latestRow = await db
    .select({ date: schema.sectorSnapshot.date })
    .from(schema.sectorSnapshot)
    .orderBy(desc(schema.sectorSnapshot.date))
    .limit(1);
  const date = latestRow[0]?.date;

  // Key indices
  const keyNames = ['NIFTY 50', 'NIFTY BANK', 'NIFTY MIDCAP 150'];
  const allSectors = date
    ? await db
        .select()
        .from(schema.sectorSnapshot)
        .where(eq(schema.sectorSnapshot.date, date))
    : [];

  const indexMap = new Map(allSectors.map(s => [s.indexName, s]));
  const indices: IndexData[] = keyNames.map(name => ({
    indexName: name,
    pctChange: indexMap.get(name)?.pctChange ?? 0,
  }));

  // Breadth from all sectors
  const breadth = allSectors.reduce(
    (acc, s) => ({
      advance: acc.advance + (s.advance ?? 0),
      decline: acc.decline + (s.decline ?? 0),
    }),
    { advance: 0, decline: 0 },
  );

  // Latest FII/DII
  const fiiDiiRows = await db
    .select()
    .from(schema.fiiDii)
    .orderBy(desc(schema.fiiDii.date))
    .limit(1);
  const fiiDii: FiiDiiData | null = fiiDiiRows[0] ?? null;
  const fiiNet =
    fiiDii && fiiDii.fiiBuy != null && fiiDii.fiiSell != null
      ? fiiDii.fiiBuy - fiiDii.fiiSell
      : null;
  const diiNet =
    fiiDii && fiiDii.diiBuy != null && fiiDii.diiSell != null
      ? fiiDii.diiBuy - fiiDii.diiSell
      : null;

  // Short display names
  const shortNames: Record<string, string> = {
    'NIFTY 50': 'Nifty',
    'NIFTY BANK': 'BankNifty',
    'NIFTY MIDCAP 150': 'Midcap150',
  };

  return (
    <div className="top-strip" id="top-strip">
      {indices.map(idx => (
        <div key={idx.indexName} className="top-strip-item">
          <span className="top-strip-label">{shortNames[idx.indexName] ?? idx.indexName}</span>
          <span className={`top-strip-value ${pctColor(idx.pctChange)}`}>
            {formatPct(idx.pctChange)}
          </span>
        </div>
      ))}

      <div className="top-strip-item">
        <span className="top-strip-label">A / D</span>
        <span className="top-strip-value">
          <span className="text-bullish">{breadth.advance}</span>
          <span style={{ color: 'var(--text-dim)', margin: '0 4px', fontSize: '0.8em' }}>/</span>
          <span className="text-bearish">{breadth.decline}</span>
        </span>
      </div>

      <div className="top-strip-item">
        <span className="top-strip-label">FII Net</span>
        <span className={`top-strip-value ${pctColor(fiiNet)}`}>{formatCr(fiiNet)}</span>
        <span className="top-strip-sub">
          DII: <span className={pctColor(diiNet)}>{formatCr(diiNet)}</span>
        </span>
      </div>
    </div>
  );
}
