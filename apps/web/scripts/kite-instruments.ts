/**
 * Sync the Kite instrument dump into `kite_instruments`.
 *
 * Historical data is keyed on `instrument_token`, not tradingsymbol, so this map
 * is a prerequisite for any intraday ingestion.
 *
 * Tokens are NOT stable forever — they change on corporate events and relistings,
 * so this should be re-run periodically (weekly is ample) rather than treated as
 * a one-off. Rows are upserted, so re-running is safe and cheap.
 *
 * Only NSE cash-segment equities are kept; derivatives and other segments are
 * irrelevant to the strategies under test and would bloat the table.
 *
 * Usage: KITE_API_KEY=... KITE_ACCESS_TOKEN=... node scripts/kite-instruments.ts
 */

import { sql } from './lib/db.ts';
import { instrumentsCsv } from './lib/kite.ts';

async function run(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS kite_instruments (
      tradingsymbol    text PRIMARY KEY,
      instrument_token bigint NOT NULL,
      exchange         text,
      instrument_type  text,
      updated_at       timestamptz NOT NULL DEFAULT now()
    )
  `;

  const csv = await instrumentsCsv('NSE');
  if (!csv) {
    console.error('[instruments] fetch failed');
    process.exit(1);
  }

  const lines = csv.split('\n').filter(l => l.trim());
  const head = lines[0].split(',');
  const idx = (name: string) => head.indexOf(name);
  const iTok = idx('instrument_token');
  const iSym = idx('tradingsymbol');
  const iType = idx('instrument_type');
  const iSeg = idx('segment');
  const iExch = idx('exchange');

  if (iTok < 0 || iSym < 0) {
    console.error('[instruments] unexpected CSV header:', head.join(','));
    process.exit(1);
  }

  const rows: Array<Record<string, unknown>> = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < head.length) continue;
    // Cash-segment equities only.
    if (c[iSeg] !== 'NSE' || c[iType] !== 'EQ') continue;
    const sym = c[iSym].trim();
    const tok = Number(c[iTok]);
    if (!sym || !Number.isFinite(tok)) continue;
    rows.push({
      tradingsymbol: sym,
      instrument_token: tok,
      exchange: c[iExch] ?? 'NSE',
      instrument_type: c[iType],
    });
  }

  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    await sql`
      INSERT INTO kite_instruments ${sql(
        chunk, 'tradingsymbol', 'instrument_token', 'exchange', 'instrument_type',
      )}
      ON CONFLICT (tradingsymbol) DO UPDATE
        SET instrument_token = excluded.instrument_token,
            updated_at = now()
    `;
  }

  // How much of the tradeable universe can we actually map?
  const [cov] = await sql<{ liquid: string; mapped: string }[]>`
    WITH liq AS (
      SELECT DISTINCT ticker FROM _turnover
      WHERE date > (CURRENT_DATE - 365) AND t20 >= 1e9
    )
    SELECT count(*)::text AS liquid,
           count(k.tradingsymbol)::text AS mapped
    FROM liq LEFT JOIN kite_instruments k ON k.tradingsymbol = liq.ticker
  `;
  console.log(`[instruments] ${rows.length} NSE equities upserted`);
  console.log(`[instruments] liquid universe coverage: ${cov.mapped}/${cov.liquid} mapped`);
  if (Number(cov.mapped) < Number(cov.liquid)) {
    console.log('  Unmapped names are usually renamed/delisted symbols — check before ingesting.');
  }
  await sql.end();
}

run().catch(async err => {
  console.error('[instruments] fatal:', err instanceof Error ? err.message : err);
  await sql.end();
  process.exit(1);
});
