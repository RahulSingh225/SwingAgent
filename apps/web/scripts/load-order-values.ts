/**
 * Load parsed order values (JSONL) into Postgres.
 *
 * The Python side owns fetching and parsing because PyMuPDF is the only usable
 * PDF text extractor available here; this script is the bridge back into the
 * database. Re-running is safe — rows are upserted on seq_id.
 *
 * `evidence` and `confidence` are stored deliberately: an order value with no
 * auditable provenance is exactly the kind of silently-wrong input that would
 * discredit the ratio study. Every figure can be traced to the sentence it came
 * from, and any analysis can filter on confidence.
 *
 * Usage: node scripts/load-order-values.ts <order_values.jsonl>
 */

import { readFileSync } from 'node:fs';
import { sql } from './lib/db.ts';

interface Row {
  seq_id: string;
  symbol: string | null;
  status: string | null;
  value_cr: number | null;
  confidence: string;
  n_candidates: number;
  evidence: string | null;
}

async function run(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node scripts/load-order-values.ts <order_values.jsonl>');
    process.exit(1);
  }

  await sql`
    CREATE TABLE IF NOT EXISTS order_values (
      seq_id       text PRIMARY KEY,
      symbol       text,
      pdf_status   text,
      value_cr     double precision,
      confidence   text NOT NULL,
      n_candidates integer NOT NULL DEFAULT 0,
      evidence     text
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS order_values_conf_idx ON order_values (confidence)`;
  await sql`CREATE INDEX IF NOT EXISTS order_values_val_idx ON order_values (value_cr)`;

  const rows: Row[] = readFileSync(path, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l) as Row);

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map(r => ({
      seq_id: r.seq_id,
      symbol: r.symbol ?? null,
      pdf_status: r.status ?? null,
      value_cr: Number.isFinite(r.value_cr as number) ? r.value_cr : null,
      confidence: r.confidence ?? 'none',
      n_candidates: r.n_candidates ?? 0,
      evidence: r.evidence ?? null,
    }));
    await sql`
      INSERT INTO order_values ${sql(
        chunk, 'seq_id', 'symbol', 'pdf_status', 'value_cr',
        'confidence', 'n_candidates', 'evidence',
      )}
      ON CONFLICT (seq_id) DO UPDATE SET
        value_cr = excluded.value_cr,
        confidence = excluded.confidence,
        n_candidates = excluded.n_candidates,
        evidence = excluded.evidence,
        pdf_status = excluded.pdf_status
    `;
  }

  const summary = await sql<{ confidence: string; n: string; median: number | null }[]>`
    SELECT confidence, count(*)::text AS n,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY value_cr)::numeric, 1) AS median
    FROM order_values GROUP BY confidence ORDER BY count(*) DESC
  `;
  console.log(`[load] ${rows.length} rows`);
  for (const s of summary) {
    console.log(`  ${s.confidence.padEnd(8)} ${s.n.padStart(6)}   median ₹${s.median ?? '-'} cr`);
  }

  await sql.end();
}

run().catch(async err => {
  console.error('[load] fatal:', err);
  await sql.end();
  process.exit(1);
});
