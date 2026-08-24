/**
 * Locate the date each corporate action actually hit the price series.
 *
 * NSE's stated `exDate` is not reliably the first session at the new price —
 * SAREGAMA's 10:1 split is stamped 2022-04-25 but the price only re-bases on
 * 2022-04-26, while EICHERMOT's lines up exactly. Trusting the metadata puts a
 * fake ±900% bar into whichever series is off by one.
 *
 * So the date is derived from the data instead: look for the session near the
 * stated ex-date whose overnight price ratio matches the expected factor. If no
 * such session exists, the action never moved the quoted price (already
 * adjusted upstream, cancelled, or mis-stated) and is marked non-effective so
 * the adjustment skips it.
 *
 * Actions sharing a ticker and ex-date are matched as one combined factor —
 * SBC did a 1:1 bonus and a 10:1 split on the same day, a compound 0.05.
 *
 * Usage: node scripts/detect-split-dates.ts
 */

import { sql } from './lib/db.ts';

/** Widest accepted mismatch between observed gap and expected factor (±25%). */
const TOLERANCE_LN = Math.log(1.25);
/** Sessions either side of the stated ex-date to search. */
const SEARCH_DAYS = 6;

interface ActionGroup {
  ticker: string;
  ex_date: string;
  ids: number[];
  combined: number;
}

async function run(): Promise<void> {
  const groups = await sql<ActionGroup[]>`
    SELECT ticker,
           ex_date::text AS ex_date,
           array_agg(id) AS ids,
           exp(sum(ln(adj_factor))) AS combined
    FROM corporate_actions
    WHERE adj_factor IS NOT NULL AND adj_factor > 0
    GROUP BY ticker, ex_date
    ORDER BY ex_date
  `;

  console.log(`[detect] ${groups.length} action groups to locate`);

  let detected = 0;
  let noPriceData = 0;
  let noGap = 0;

  for (const g of groups) {
    // Raw (unadjusted) closes bracketing the stated ex-date.
    const bars = await sql<{ date: string; close: number }[]>`
      SELECT date::text AS date, close
      FROM eod_prices
      WHERE ticker = ${g.ticker}
        AND date BETWEEN (${g.ex_date}::date - ${SEARCH_DAYS}::int)
                     AND (${g.ex_date}::date + ${SEARCH_DAYS}::int)
      ORDER BY date
    `;

    if (bars.length < 2) {
      noPriceData++;
      await sql`
        UPDATE corporate_actions
        SET effective_date = NULL, detection_note = 'no price data in window'
        WHERE id = ANY(${g.ids})
      `;
      continue;
    }

    // Find the overnight ratio closest to the expected combined factor.
    const target = Math.log(Number(g.combined));
    let best: { date: string; err: number; ratio: number } | null = null;
    for (let i = 1; i < bars.length; i++) {
      const prev = Number(bars[i - 1].close);
      const cur = Number(bars[i].close);
      if (!(prev > 0) || !(cur > 0)) continue;
      const err = Math.abs(Math.log(cur / prev) - target);
      if (!best || err < best.err) {
        best = { date: bars[i].date, err, ratio: cur / prev };
      }
    }

    if (best && best.err <= TOLERANCE_LN) {
      detected++;
      await sql`
        UPDATE corporate_actions
        SET effective_date = ${best.date},
            detection_note = ${`matched ratio ${best.ratio.toFixed(4)} vs expected ${Number(g.combined).toFixed(4)}`}
        WHERE id = ANY(${g.ids})
      `;
    } else {
      noGap++;
      await sql`
        UPDATE corporate_actions
        SET effective_date = NULL,
            detection_note = ${`no matching gap (best ratio ${best ? best.ratio.toFixed(4) : 'n/a'} vs expected ${Number(g.combined).toFixed(4)})`}
        WHERE id = ANY(${g.ids})
      `;
    }
  }

  console.log(
    `[detect] located ${detected}, no price data ${noPriceData}, no matching gap ${noGap}`,
  );

  // How far the true date drifts from the stated one — worth knowing.
  const drift = await sql<{ drift: number; n: string }[]>`
    SELECT (effective_date - ex_date) AS drift, count(*)::text AS n
    FROM corporate_actions
    WHERE effective_date IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `;
  console.log('[detect] effective_date − ex_date:');
  for (const d of drift) {
    console.log(`   ${String(d.drift).padStart(3)} day(s): ${d.n}`);
  }

  await sql.end();
}

run().catch(async err => {
  console.error('[detect] fatal:', err);
  await sql.end();
  process.exit(1);
});
