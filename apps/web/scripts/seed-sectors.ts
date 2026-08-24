/**
 * Populate `companies.sector` so the ledger can be sliced by the trader's
 * actual universe (Defence / Telecom / Infrastructure).
 *
 * Two sources, because neither alone is sufficient:
 *
 * 1. NSE's own `smIndustry`, taken as the most frequent non-null value per
 *    symbol across all its filings. Covers ~1,450 of 2,932 symbols and is fine
 *    for Telecom and Infrastructure, which map cleanly onto its buckets.
 *
 * 2. An explicit Defence list, because NSE has no Defence industry at all — BEL
 *    sits under "Electronics - Industrial", BEML under "Engineering", Solar
 *    Industries under "Chemicals - Speciality". No keyword mapping recovers that.
 *
 * SURVIVORSHIP NOTE: the Defence list is enumerated as of 2026, so it inherently
 * favours names that still exist. The list is deliberately broad (long-listed
 * PSUs plus private names, including underperformers) to limit the skew, but any
 * Defence-only result should be read as a mild upper bound, not a clean estimate.
 * Recent IPOs simply contribute from their listing date, which is availability,
 * not bias.
 *
 * Usage: node scripts/seed-sectors.ts
 */

import { sql } from './lib/db.ts';

/** NSE smIndustry → coarse sector bucket. */
const INDUSTRY_MAP: Record<string, string> = {
  'Telecommunication - Services': 'Telecom',
  'Telecommunication - Equipment': 'Telecom',
  'Cables - Telecom': 'Telecom',
  Construction: 'Infrastructure',
  'Cement And Cement Products': 'Infrastructure',
  Power: 'Infrastructure',
  Engineering: 'Infrastructure',
  Shipping: 'Infrastructure',
  'Cables - Power': 'Infrastructure',
  'Electrical Equipment': 'Infrastructure',
  'Steel And Steel Products': 'Metals',
  Metals: 'Metals',
  Mining: 'Metals',
  'Computers - Software': 'IT',
  'Computers - Hardware': 'IT',
  Pharmaceuticals: 'Pharma',
  Banks: 'Financials',
  Finance: 'Financials',
};

/**
 * Defence-exposed listed names. Broad on purpose — includes shipyards, ordnance,
 * electronics, explosives and component suppliers, and names that have done
 * poorly as well as well.
 */
const DEFENCE = [
  'HAL', 'BEL', 'BDL', 'BEML', 'MAZDOCK', 'COCHINSHIP', 'GRSE', 'MIDHANI',
  'DATAPATTNS', 'PARAS', 'ZENTEC', 'ASTRAMICRO', 'IDEAFORGE', 'SOLARINDS',
  'DYNAMATECH', 'APOLLO', 'APOLLOMIC', 'MTARTECH', 'AZAD', 'UNIMECH',
  'TANEJAAERO', 'BHARATFORG', 'WALCHANNAG', 'PREMEXPLN', 'SIKA', 'CENTUMELEC',
  'HBLENGINE', 'TITAGARH', 'RTNPOWER', 'KRBL', 'SHIVALIK', 'VALIANTLAB',
];

async function run(): Promise<void> {
  // Ensure every symbol that appears in the corpus has a companies row.
  await sql`
    INSERT INTO companies (ticker, name)
    SELECT DISTINCT a.symbol, coalesce(max(a.company_name), a.symbol)
    FROM announcements_raw a
    WHERE a.symbol IS NOT NULL
    GROUP BY a.symbol
    ON CONFLICT (ticker) DO NOTHING
  `;

  // Modal smIndustry per symbol.
  await sql`DROP TABLE IF EXISTS _symbol_industry`;
  await sql`
    CREATE TABLE _symbol_industry AS
    SELECT symbol, sm_industry, n FROM (
      SELECT symbol, sm_industry, count(*) AS n,
             row_number() OVER (PARTITION BY symbol ORDER BY count(*) DESC) AS rn
      FROM announcements_raw
      WHERE symbol IS NOT NULL AND sm_industry IS NOT NULL AND sm_industry <> '-'
      GROUP BY symbol, sm_industry
    ) t WHERE rn = 1
  `;

  // Raw industry first — useful even where it does not map to a bucket.
  await sql`
    UPDATE companies c
    SET sector = si.sm_industry
    FROM _symbol_industry si
    WHERE c.ticker = si.symbol
  `;

  // Collapse into coarse buckets where a mapping exists.
  for (const [industry, bucket] of Object.entries(INDUSTRY_MAP)) {
    await sql`
      UPDATE companies c SET sector = ${bucket}
      FROM _symbol_industry si
      WHERE c.ticker = si.symbol AND si.sm_industry = ${industry}
    `;
  }

  // Defence overrides everything — it cuts across NSE's industries.
  await sql`
    UPDATE companies SET sector = 'Defence' WHERE ticker = ANY(${DEFENCE})
  `;

  const rows = await sql<{ sector: string; n: string }[]>`
    SELECT coalesce(sector, '(none)') AS sector, count(*)::text AS n
    FROM companies GROUP BY 1 ORDER BY count(*) DESC LIMIT 12
  `;
  console.log('[sectors] top buckets:');
  for (const r of rows) {
    console.log(`  ${r.sector.padEnd(28)} ${r.n}`);
  }

  const [{ filled, total }] = await sql<{ filled: string; total: string }[]>`
    SELECT count(sector)::text AS filled, count(*)::text AS total FROM companies
  `;
  console.log(`[sectors] ${filled}/${total} companies labelled`);

  await sql.end();
}

run().catch(async err => {
  console.error('[sectors] fatal:', err);
  await sql.end();
  process.exit(1);
});
