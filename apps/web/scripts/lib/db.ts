/** Standalone Postgres client for the backfill scripts (no Next.js runtime). */

import postgres from 'postgres';

const URL_ =
  process.env.DATABASE_URL ?? 'postgres://marketos:marketos@localhost:5432/marketos';

export const sql = postgres(URL_, { max: 4, onnotice: () => {} });

/** Record a completed backfill window so a killed crawl resumes cleanly. */
export async function checkpoint(
  job: string,
  windowKey: string,
  rows: number,
  status: 'done' | 'failed' = 'done',
  note?: string,
): Promise<void> {
  await sql`
    INSERT INTO backfill_progress (job, window_key, status, rows, note)
    VALUES (${job}, ${windowKey}, ${status}, ${rows}, ${note ?? null})
    ON CONFLICT (job, window_key) DO UPDATE
      SET status = excluded.status,
          rows = excluded.rows,
          note = excluded.note,
          completed_at = now()
  `;
}

/** Windows already completed for a job — used to skip work on resume. */
export async function doneWindows(job: string): Promise<Set<string>> {
  const rows = await sql<{ window_key: string }[]>`
    SELECT window_key FROM backfill_progress WHERE job = ${job} AND status = 'done'
  `;
  return new Set(rows.map(r => r.window_key));
}
