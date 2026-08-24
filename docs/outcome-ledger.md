# Outcome Ledger — Strategy, Plan & Handover

**Status as of 2026-08-04.** Written so someone who has never seen this project can
pick it up. Read sections 1–3 before touching code; section 6 will save you a day.

---

## 1. Why this exists

### The trader

One person, a technical lead with a full-time job. Target interaction time is
**~10 minutes on a weekday evening**, plus a ~45-minute weekly review. Trades
catalyst-driven swings (order wins, contracts, LoIs) with a bias toward Defence,
Telecom and Infrastructure. Wants a reliable secondary income, not a thrill.

### The thesis

The obvious system to build is a fast news reader that scores announcements out
of 10 and pushes alerts. That was in fact half-built before this work started, and
**it is the wrong bet.**

A part-time trader cannot win the speed race. Desks read BSE/NSE filings the
second they land; by the time a Google Alert fires, the filing is often hours old
and the move is half-done. Speed is a losing axis.

The edge available to this trader is **interpretation and patience** — correctly
judging whether a catalyst is durable, and being willing to hold 5–20 days while
day-traders chase and abandon the day-one pop.

An impact score of "8/10" is an *opinion*. Nobody ever checked whether an 8 does
better than a 5. The ledger replaces the opinion with a **base rate**:

> Defence · firm order · smallcap.
> 41 similar events since 2019. 6 in 10 were profitable.
> Median excess return by day 5: +2.4%. Worst decile: −8%.

That is falsifiable, and it makes the system self-correcting — if the score has no
predictive power, you find out in a month rather than never.

### The three-layer decision model

Catalyst and technicals are **not** parallel scores to be added. They are
sequential, with different jobs:

| Layer | Job | Question |
|---|---|---|
| Catalyst | Idea generation | Is something genuinely new and material? |
| Fundamental context | Conviction & sizing | Does it move the needle for *this* company? |
| Technicals | Timing & risk **only** | Where's the entry and stop? Am I already late? |

Technicals never generate an idea. This is the concrete meaning of the trader's
constraint: *"I cannot rely on charts alone."*

### The governing principle

> Consistency is a risk-management property, not a signal property.

Most of a year's losses come from trades taken because it felt like something
should be happening. So the system is built to **enforce discipline structurally**
(max 2 positions, fixed fractional risk, stop placed with entry, no thesis → no
trade, 3 losses → forced week off) and to be comfortable saying *"nothing worth
trading this week."*

---

## 2. Scope decisions (and why)

| Decision | Rationale |
|---|---|
| **Ledger first.** Every other feature is judged by whether it improves base rates. | Without a feedback loop, every other feature is decoration. |
| **Full NSE universe**, not a curated ~120 Defence/Telecom/Infra list. | Curating 2026's winners and backtesting their past is survivorship bias — base rates would read better than reality. Filter at query time instead. |
| **Single-dimension slicing**, n ≥ 30, **no Bayesian shrinkage**. | Slicing on type × sector × cap × size gives ~135 cells and a dozen samples each. Shrinkage is a week of work to rescue a scheme you should simply not use. Avoid the sparsity, don't tool around it. |
| **Returns are split-adjusted, benchmark-relative, and cost-netted.** | A +2.4% median means nothing if the Nifty rose 2%. Smallcap round-trip costs turn a marginal edge into none. |
| **Regime is a column, not a filter.** | With max 2 positions at ~1% risk, a regime filter's marginal benefit is small. Measure whether catalysts actually lose money in downtrends before installing a rule — otherwise it's another unvalidated rule. |
| **The LATE threshold is derived from the ledger**, not hardcoded. | Hand-setting "6–8% on 3× volume" is exactly the habit this system exists to kill. |
| **Surveillance categories are excluded** (`Price movement`, `Spurt in Volume`, `News Verification`). | These are the exchange asking a company *why its stock already moved*. They are consequences, not causes — including them is guaranteed look-ahead contamination. They were **46% of naive keyword hits.** |
| **BSE dropped entirely.** | Its API soft-blocks non-browser clients. NSE supplies the ticker symbol directly and nearly everything dual-lists. (Note: `lib/ingestion/bse.ts` has therefore **never returned a row**.) |
| **Order value deferred to a later phase.** | Only ~11% of order announcements carry an extractable ₹ figure in the API metadata; the rest need the linked PDF. Ledger v1 measures event *type* only. |
| **0DTE / near-expiry options cut.** | They demand intraday attention the trader does not have. Fastest way to destroy a side-income account. |
| **Old 1–10 score kept only as a triage key**, retired on evidence. | Comparison is done *offline* over the whole corpus, not by live A/B — at 1–3 trades a month a live test would need years to reach significance. |

---

## 3. Architecture

```
NSE archives ──► backfill scripts ──► Postgres ──► ledger ──► base rates ──► evening brief
   (public)        (apps/web/scripts)              (views)      (n≥30)         (Telegram)
```

Everything lives in the **`SwingAgent`** monorepo (`market-os`), in `apps/web`.
`MarketFeeds` is superseded and should be archived after salvaging its X/Twitter
ingestion and FCM push. `AlertsReader` (React Native) becomes a **read-only
client** later; it currently runs its own duplicate on-device pipeline.

**Runner:** Node 24 executes TypeScript natively — `node scripts/foo.ts`. No
`tsx`, no build step. Scripts use the `postgres` client directly (not Drizzle) so
they stay standalone and avoid Next.js path aliases.

---

## 4. Current status

### Done and verified ✅

| Task | Result |
|---|---|
| Infra | Docker + Postgres 16 healthy on `localhost:5432` |
| Ledger schema | `corporate_actions`, `index_prices`, `announcements_raw`, `backfill_progress` |
| Corporate actions backfill | **25,503** actions (2015–2026), **846** with adjustment factors |
| Ratio parser | **13/13 unit tests pass** (bonus, split, consolidation, dividend) |
| Price + index backfill | **3,224,780 bars**, 1,773 trading days, 3,234 tickers, Oct 2019 → Aug 2026 |
| Index history | **169 indices** incl. NIFTY 50 — the benchmark leg |
| Announcements backfill | **1,324,026** rows (2015–2026), 2,932 tickers, 350 categories |
| Split effective-date detection | 457 groups located; **470/476 were off by +1 day** |
| Adjusted price series | `eod_prices_adj` materialised view — **verification PASSES** |

### Verification evidence

Known splits, after adjustment (raw gap should be large, adjusted gap ~0):

```
ticker        eff_date    factor   raw_gap%   adj_gap%
NESTLEIND     2024-01-05  0.1        -90.2       -1.7
SAREGAMA      2022-04-26  0.1        -90.0       -0.1
RMDRIP        2025-09-26  0.1        -90.0        0.1
EICHERMOT     2020-08-23  0.1        -90.0        0.3
```

### Usable event population (inside the price window)

| Event type | Events | Tickers |
|---|---|---|
| Firm order | 2,238 | 545 |
| Contract (other) | 4,067 | 656 |
| LoI / LoA | 847 | 209 |
| L1 / lowest bidder | 214 | 24 |

**7,366 order-type events.** Every bucket clears n ≥ 30 comfortably.

### Also completed since ✅

| Task | Result |
|---|---|
| `event_outcomes` ledger | Built; return arithmetic hand-verified |
| Sector seeding | `companies.sector` populated (Defence via explicit list) |
| Order-value extraction | 7,325 PDFs → 2,340 high-confidence values, ~88% precision |
| Historical indicators | 3,218,203 rows; verified to 0.00000000 MAE vs SQL |
| Screener replay | 11,474 signals across 1,773 sessions |
| **All catalyst theses tested** | **See [ledger-findings.md](ledger-findings.md) — closed** |

### Not built, and deliberately so ⬜

The downstream system (LATE detector, fundamentals layer, evening brief,
dashboard, mobile client) was **never built**, because the ledger closed the
thesis it would have served. That was the point of building the ledger first.

---

## 5. Plan as executed

> **Phases 4–6 below are complete.** They are kept as a record of the conventions
> actually used, since every number in [ledger-findings.md](ledger-findings.md)
> depends on them. The outcome was negative — see that document before planning
> any further work.

### Phase 4 — The ledger *(done)*

Create `event_outcomes`: for every classified event, forward returns at
**T+1 / T+3 / T+5 / T+10**.

Non-negotiable rules:

- **Entry = next session's open after `announced_at`.** Filings after 15:30 IST
  skip a day. This is the look-ahead guard — get it wrong and every number lies.
- **Adjusted prices only** (`eod_prices_adj`, never `eod_prices`).
- **Excess return vs NIFTY 50** over the identical window.
- **Cost-netted**: 0.35% round-trip assumption, configurable.
- **Overlap rule**: another material event on the same ticker inside the window →
  keep the first, drop the rest.
- **Liquidity floor**: 20-day average turnover ≥ ₹5 Cr, else excluded as untradeable.
- **Regime tagged** as a column (Nifty vs its 50DMA on the event date).

### Phase 5 — The verdict *(done — negative)*

Written up as [ledger-findings.md](ledger-findings.md). The gate was: *if
catalysts show no edge at all, stop — do not build the rest.* That gate fired.

The existing 1–10 `impactScore` was never tested directly (`events` holds only 11
rows). It became moot: event type, sector and order size all fail to predict, so a
keyword-weighted composite of the same inputs had nowhere to draw signal from.

### Phase 6+ — not built

LLM classification, LATE detector, order-value ÷ revenue, enforced risk rules,
evening brief, Telegram, dashboard, mobile client. All were conditional on Phase 5
showing an edge. It did not.

**The one thing worth carrying forward** is order size as a *don't-buy* filter —
the only finding that survived out-of-sample testing.

---

## 6. Gotchas — read this before debugging anything

Hard-won. Each of these cost real time or would have silently corrupted results.

1. **NSE's stated `exDate` is not when the price re-bases.** In **470 of 476**
   observed cases the price splits **one session later**. Never key adjustments on
   `ex_date` — use `effective_date`, populated by `detect-split-dates.ts`, which
   finds the session whose actual price gap matches the expected ratio. This also
   correctly rejected 10 corporate actions that were recorded but never happened.

2. **`window` is a reserved word in Postgres.** The column is `window_key`.

3. **`postgres.js` does *not* convert camelCase to snake_case.** Object keys map
   straight to column names. Build insert objects with snake_case keys or you get
   `column "deliveryPct" does not exist` — and because it's caught per-batch, the
   job *keeps running* while inserting nothing.

4. **`https://www.nseindia.com/` returns 403** to non-browser clients. Prime
   cookies from a *content* page (`/companies-listing/corporate-filings-announcements`)
   instead. Sessions expire mid-crawl; re-prime on any failure.

5. **BSE signals blocking as `"No Record Found!"` with HTTP 200**, not a 403. If
   BSE returns empty for *today*, you are blocked, not looking at an empty archive.

6. **`sec_bhavdata_full` only goes back to ~Sep 2019.** Earlier data needs the
   legacy `cmDDMMMYYYYbhav.csv.zip` format (no delivery %). The current backfill
   deliberately starts 2019-09-01.

7. **`attchmntText` is a headline, not a document** — median **128 characters**.
   Order values are in the linked PDF, not the metadata.

8. **`smIndustry` is blank ~50% of the time.** Get sector from a `companies` join.

9. **A 404 on an archive file usually means market holiday**, not a broken URL.
   Check the date is a real trading session before debugging.

10. **Node 24 runs TypeScript natively.** No `tsx` needed. Scripts must live under
    `apps/web/` to resolve `node_modules`.

11. **`drizzle-kit push` cannot rename a column.** For an empty table, drop and
    recreate by hand.

12. **A window returning ≥9,000 announcements is not necessarily truncated.** Both
    flagged windows re-crawled at 3-day granularity yielded **zero** new rows — they
    were just earnings season.

13. **CTEs cannot be indexed.** The ledger query joined a 3.2M-row CTE eight times
    and ran for over ten minutes before being killed. Materialising `_sessions`,
    `_nifty`, `_turnover` and `_typed_events` as real tables with primary keys turned
    the same joins into index lookups. If a query is inexplicably slow, look for a
    CTE being scanned repeatedly.

14. **Cancelled queries can keep their locks.** `pg_cancel_backend` did not stop a
    runaway INSERT; the follow-up `DROP TABLE` then blocked behind it and the whole
    thing deadlocked. Use `pg_terminate_backend`.

15. **EMA and Wilder's RSI are path-dependent.** Both are seeded from the start of
    whatever series you hand them, so computing them over a short history gives
    permanently different values — not just a slow warm-up. This is what made the
    live screener's `weeklyTrend` wrong for ~1 in 10 tickers. Any indicator backtest
    must use the full available history, and must be validated against an
    independent computation (`hist_indicators` matches SQL to 0.00000000 MAE).

16. **Use adjusted prices for indicators, raw prices for price filters.** A split
    would otherwise fire spurious SMA crossings; conversely a "> ₹200" universe rule
    must see the price the trader actually saw on the day.

---

## 7. How to run it

```bash
# Infra
cd SwingAgent && docker compose up -d postgres
cd apps/web && npx drizzle-kit push

# Backfills (resumable — safe to re-run; they skip completed windows)
node scripts/backfill-corp-actions.ts 2015 2026
node scripts/backfill-prices.ts 2019-09-01 2026-08-04     # ~2h
node scripts/backfill-announcements.ts 2015-01-01 2026-08-04 10   # ~2h

# Adjustment (order matters — detect before build)
node scripts/detect-split-dates.ts
node scripts/build-adjusted-prices.ts     # exits non-zero if verification fails

# Tests
node scripts/test-corp-actions.ts
```

Progress lives in `backfill_progress`. To force a re-crawl, delete the relevant
rows. Failed windows are recorded with `status='failed'` and retried on re-run.

---

## 8. Open risks

- **Selection bias in ingestion.** Base rates describe events *as they reach the
  pipeline* — media-covered ones skew bigger and later. Decision-relevant, but not
  the population of all catalysts.
- **The weekly recalibration loop is itself an overfitting engine.** Change weights
  quarterly at most; hold out the most recent 6–12 months as untouched validation.
- **Multiple comparisons.** Pre-commit to a small number of hypotheses before
  slicing; do not go fishing across feature combinations.
- **Regime dependence.** A base rate computed mostly over a bull tape is not a base
  rate. The window (Oct 2019 →) does cover COVID, 2022's correction and two bulls.
- **Dividends are not adjusted for.** The ledger measures price return, not total
  return. Stated deliberately so nobody assumes otherwise.
- **Market cap is estimated**, not sourced, in the existing heatmap endpoint.
- **Nothing is deployed.** All local. Crons cannot run on a laptop.

---

## 9. Realistic expectations

A modest positive expectancy with lumpy months — not a smooth second salary. The
gains come from taking fewer, better-sized trades consistently. **A system that
reliably says "nothing worth trading this week" is doing its job.**
