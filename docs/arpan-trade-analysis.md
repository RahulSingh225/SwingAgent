# Arpan Sengupta (Blu_Dragon) — Trade Pattern & Psychology Analysis

**Date:** 2026-08-24
**Source:** `resources/Arpan Sengupta (Blu_Dragon) – Verified P&L Trades.xlsx`
**Profile:** 1458f757 | Period: approx Aug 2025 – Aug 2026
**Scope:** 1,476 instrument-level aggregates, ₹18.74L net realised

---

## 0. Correction to the premise

**The "97% win rate" is not supported by this data.**

| Metric | Value |
|---|---|
| Instrument-level win rate | **75.2%** (1,110 W / 365 L / 1 flat) |
| Profit factor | **1.46** (₹5.97M gross profit vs ₹4.10M gross loss) |
| Net realised | ₹1,874,088 |

Only the **Equity** segment approaches the claim at 95.7% — on 23 positions worth
₹134k, i.e. 7% of his net. F&O is 74.8%, Commodity 75.3%.

75% with a 1.46 profit factor is a good trader. It is not a 97% trader, and the
difference matters enormously for how much of his behaviour you should copy.

> **Definitional caveat.** One row = one symbol's *lifetime* net, not one trade.
> Multiple entries/exits in a symbol net out before we see them, so the true
> per-trade win rate is unknown and could differ in either direction.

---

## 1. Filtered Pattern Hypotheses

### H1 — His entire edge is cheap-OTM option buying, and it is monotonic in entry premium

| Avg entry premium | n | Net P&L | Win % |
|---|---|---|---|
| < ₹1 | 111 | **+₹710,110** | 88% |
| ₹1–5 | 141 | +₹431,643 | 74% |
| ₹5–20 | 256 | **+₹895,070** | 89% |
| ₹20–50 | 316 | **+₹938,936** | 85% |
| ₹50–100 | 241 | +₹535,291 | 75% |
| ₹100–300 | 230 | +₹339,209 | 60% |
| ₹300–1000 | 125 | **−₹1,239,064** | 46% |
| > ₹1000 | 20 | **−₹900,986** | 15% |

Win rate falls almost monotonically as entry premium rises. Every bucket below
₹300 is profitable; both buckets above it are catastrophic.

- Sub-₹300 book: **+₹3,850,261**
- ₹300+ book: **−₹2,140,050**

**Counterfactual: had he never taken a position above ₹300 premium, net option P&L
would be ₹3.85M instead of ₹1.71M — 2.25×.** The expensive book destroyed more
than his entire realised profit.

### H2 — The pattern holds across every underlying, so it is behavioural, not instrument-specific

| Underlying | Cheap (<₹50) | Win% | Expensive (≥₹50) | Win% |
|---|---|---|---|---|
| CRUDEOIL | **+₹714,820** (n=29) | **100%** | +₹102,940 (n=138) | 71% |
| NIFTY | **+₹1,125,556** (n=378) | 86% | **−₹682,830** (n=137) | 47% |
| SENSEX | +₹640,588 (n=199) | 89% | −₹515,549 (n=170) | 61% |
| BANKNIFTY | +₹137,368 (n=32) | 84% | −₹182,860 (n=74) | 58% |

Four different underlyings, same sign flip. This is a property of *how he sizes
and selects premium*, not of any particular market.

### H3 — He makes money on volatility expansion and bleeds on quiet days

NIFTY behaviour on his top F&O days, against a 1,688-day baseline:

| | \|Return\| | \|Gap\| | 20d vol | Prior 5d |
|---|---|---|---|---|
| **Top profit days** (n=14) | **0.90%** | **0.82%** | 0.98 | −0.53% |
| **Top loss days** (n=15) | 0.62% | 0.48% | 0.69 | +0.09% |
| Baseline (all days) | 0.74% | 0.45% | 0.93 | +0.20% |

His profit days carry **~2× the baseline gap** and above-baseline range. His loss
days are *quieter than average* — smaller moves, ordinary gaps, flat prior trend.

### H4 — He sizes up when he is wrong

| | Median capital deployed | Mean |
|---|---|---|
| Top profit days | ₹56,667 | ₹55,742 |
| Top loss days | **₹173,455** | **₹310,133** |

**3.1× more capital on losing days by median, 5.6× by mean.** His single worst day
(2025-10-06, −₹96,620) shows ₹2.19M of buy value — roughly 40× a typical profit day.

This is the most important psychological finding in the dataset, and it compounds
H1: conviction leads to expensive options *and* larger size simultaneously.

### H5 — Puts outperform calls, and call losses are larger

| | n | Net | Win% | Avg win | Avg loss |
|---|---|---|---|---|---|
| PE | 625 | **+₹1,190,710** | 75% | ₹5,783 | −₹9,556 |
| CE | 676 | +₹514,047 | 76% | ₹5,583 | **−₹14,508** |

Same win rate, but calls lose ~50% more when they lose. Consistent with buying
expensive calls into rallies that stall.

---

## 2. Supporting Evidence

**The twelve largest losses are all high-premium options that decayed:**

| Symbol | Buy Avg | Sell Avg | Decay | P&L |
|---|---|---|---|---|
| CRUDEOIL26MAY8000CE | ₹1,641 | ₹404 | −75% | **−₹247,340** |
| SENSEX2631975600PE | ₹1,193 | ₹67 | −94% | −₹112,551 |
| CRUDEOIL26JUL6400CE | ₹1,269 | ₹235 | −82% | −₹103,450 |
| SENSEX2640272400CE | ₹456 | ₹38 | −92% | −₹100,370 |
| NIFTY2631024250PE | ₹446 | ₹80 | −82% | −₹95,189 |
| SENSEX2640272500CE | ₹549 | ₹17 | **−97%** | −₹85,094 |

Entry premiums ₹402–₹1,641. These are deep-ITM or high-IV positions — effectively
leveraged directional bets with **no convexity** and large absolute theta.

**The risk asymmetry in one number:** the cheap book (<₹5 entry, 252 positions)
had a **maximum possible loss of ₹366,684** — the total premium paid, if every
single one expired worthless. It actually returned **+₹1,141,754**. The expensive
book lost **₹2,140,050**, six times the cheap book's worst conceivable case.

**Data integrity confirmed:** 12 positions do show Sell Avg = ₹0 (expired
worthless), with losses of ₹136–₹520 each. Total losses are present in the
dataset, so the cheap-book win rate is not a survivorship artifact.

---

## 3. Risk Observations — what characterised the big losing days

1. **Quiet markets, not violent ones.** Loss days had *below-baseline* NIFTY range
   (0.62% vs 0.74%) and ordinary gaps. He is not blown up by shocks; he is bled by
   drift.
2. **Size escalation.** 3.1× median capital on losing days.
3. **Premium escalation.** Every large loss is a ₹400+ entry.
4. **Expiry clustering.** The expensive book's damage concentrates in specific
   months — 26JUL (−₹552,696 over 11 positions) and 26MAY (−₹340,510 over 21).
5. **Segment divergence.** On 2026-03-09 he lost ₹70,616 in F&O while making
   ₹107,410 in Commodity the same day. He runs uncorrelated books simultaneously.

---

## 4. Actionable Rules

Testable, and each traces to a specific finding.

**R1 — Hard premium ceiling.** Never open an option position above ~₹300 premium
(index) or the crude equivalent. This single rule would have improved his net
2.25×. *(H1)*

**R2 — Buy convexity, not delta.** If a position needs ₹400+ of premium, express
the view in futures instead. High-premium options carry futures-like delta with
option-like theft — the worst of both. *(H1, §2)*

**R3 — Require volatility expansion before entry.** Trade cheap options on days
where the underlying gaps ≥0.8% or realised range is above its 20-day average.
Stand down on quiet drifting days. *(H3)*

**R4 — Invert his sizing rule.** Position size must be *constant or smaller* on
high-conviction trades, never larger. His conviction signal is inversely correlated
with outcome. *(H4)*

**R5 — Budget the cheap book as premium-at-risk.** Because max loss equals premium
paid, size by "how much am I willing to lose in total this month" rather than by
per-trade stop. This is the structural advantage of the cheap book and should be
used deliberately. *(§2)*

**R6 — Prefer puts, and treat expensive calls as the highest-risk trade type.**
*(H5)*

### Greeks framing (per success criteria)

- **Where he wins:** long **gamma/vega** via cheap OTM, on days when realised
  volatility expands. Small absolute theta because premium paid is small. Payoff is
  convex — the ₹0.20 → ₹494.80 positions (CRUDEOIL26MAY8100PE, +247,300%) are pure
  gamma capture.
- **Where he loses:** long **delta with heavy theta** via expensive ITM. Little
  convexity left, large absolute time decay, and full directional exposure. The
  −75% to −97% decays are theta and adverse delta, not vega crush.
- **Move already underway vs anticipation:** his profit days show prior-5-day NIFTY
  at **−0.53%** while loss days show **+0.09%**. He does better entering *after* a
  move has begun (continuation into expansion) than in flat anticipation.

---

## 5. Open Questions & Data Gaps

1. **No trade-date ↔ symbol mapping.** We have daily segment P&L and lifetime
   instrument aggregates, never both. Every day-level attribution above is
   inference, not fact.
2. **Per-trade win rate unknown.** Instrument aggregation hides intra-symbol
   scaling, averaging down, and re-entries — the behaviours most relevant to
   psychology.
3. **Entry timing unknown.** We cannot tell whether he bought cheap options
   *early* (before a move) or *late* (chasing). H3 hints at the latter but does
   not establish it.
4. **Holding period unknown.** Cannot separate intraday scalps from multi-day holds,
   which changes the theta interpretation materially.
5. **No IV data.** "Cheap" here means low rupee premium, which conflates OTM-ness
   with low implied volatility. Whether his edge is *moneyness selection* or
   *volatility timing* is unresolved and is the single most valuable missing input.
6. **Where does "97%" come from?** Not reproducible from this file at trade or
   instrument level. Possibly a daily-win-rate metric, a different period, or a
   marketing figure. Worth resolving before treating him as a model.
7. **CRUDEOIL cheap book is 29 positions at 100%.** Striking, but n=29 — plausibly
   luck. Needs more data before being treated as a real skill.

---

## 6. Bottom line

The replicable part of this trader is **narrow and specific**: buy cheap
out-of-the-money options, on volatility-expansion days, in small size, and accept
that premium paid is the whole risk.

The destructive part is equally specific: **when he is most confident, he buys
expensive options in larger size — and that book lost more than his entire net
profit.**

The lesson is not "trade like him". It is: **his good book and his bad book are
separable, and the bad one is identifiable in advance by a single number — entry
premium.**

---

# Addendum — attempt to reconstruct entry logic from intraday data (2026-08-24)

**Question asked:** he booked large profits on sub-₹1 premiums in NIFTY / BANKNIFTY
/ SENSEX — can our 5-minute history reveal what he was looking at when he picked
them?

**Answer: not at trade level, and one premise of the earlier report was wrong.**

## What the symbols do give us

Option symbols encode underlying, expiry and strike, in three formats
(`NIFTY2641323800PE` weekly, `NIFTY26JUL23900PE` monthly, `NIFTY25N1125500PE`
letter-month). A parser recovers 1,440 of 1,476 rows; the 36 misses are futures.
Expiries span 2025-09-02 → 2026-09-24. Weeklies 749, monthlies 691.

## Three blockers

1. **No trade dates anywhere in the workbook.** One row is one symbol's entire
   lifetime. `FO_Top_Profit_Days` / `FO_Top_Loss_Days` have dates (40 in total) but
   no symbol linkage. There is nothing to join 5-minute bars *to*.
2. **Coverage is NIFTY-only.** 515 of 1,440 options. SENSEX 369, CRUDEOIL 167,
   BANKEX 40 have no local price history at all; BANKNIFTY 106 exists only as the
   BANKBEES ETF proxy. Roughly 40% of the book is unjoinable in principle.
3. **The 5-minute archive starts 2026-05-13, not 2024.** yfinance serves a rolling
   60-day window; the daily capture job has only been converting it to permanent
   storage since May. 60-minute data does reach back to 2024-08-05, and
   `NIFTY50IDX` 60m runs to 2026-08-04.

## What we found anyway — the cheap book is contaminated with SHORT positions

`Buy Avg` / `Sell Avg` do not encode direction: P&L is `SellValue − BuyValue`
whichever leg came first. Two subsets are unambiguous:

| pattern | meaning | n | net |
|---|---|---|---|
| `Buy Avg = 0`, P&L > 0 | **sold** the option, expired worthless | 35 | **+₹143,637** |
| `Sell Avg = 0`, P&L < 0 | **bought** the option, expired worthless | 12 | −₹4,019 |

Among positions held to expiry, shorts outnumber longs about 3:1 — and the 35
short rows were previously bucketed as "<₹1 entries," inflating that bucket.

Supporting shape, from NIFTY moneyness at expiry:

- 46 of 50 sub-₹1 NIFTY options (**92%**) finished OTM, netting **+₹162,364**.
- Many were *never* ITM at any hour of their expiry session (`iv_max = 0`) yet
  carry ₹10–60 recorded prices — so those fills happened days earlier, on time
  value, not on an expiry-day spike.

An option you *bought* that never goes ITM is worthless. Profiting on it requires
selling into a spike that then faded, repeatedly. Premium **selling** explains the
same data with no timing skill required.

## A reconstruction was attempted and rejected as circular

Black-Scholes valuation over the option's last 15 sessions (NIFTY spot from
`_nifty`, σ scanned 10/13/16/20%), matching `Buy Avg` and `Sell Avg` to their
nearest session, then ordering them to infer direction.

Surface result: 44 SHORT vs 8 LONG among IV-robust classifications, shorts 86% win,
longs 0% win. **This is an artifact.** On a decaying asset the higher price of any
winner mechanically maps to an earlier date, so the method labels winners SHORT and
losers LONG by construction — measured at 80% and 62% respectively. Re-running at
hourly resolution while demanding the surface reproduce both prices within ₹2 left
only 13 usable rows: spot-derived BS with an assumed flat σ cannot reproduce actual
weekly-option prices closely enough to date a fill.

**Do not revive this without real option prices or an IV surface.**

## What would actually answer the question

A tradebook export with timestamp, buy/sell flag and per-fill price — the
`Buy Avg`/`Sell Avg` aggregation destroys exactly the information needed. Failing
that, historical NIFTY option chains (strike × expiry × IV, daily close minimum).
Neither is in hand.

## Feasibility test: can Greeks-modelled premium date his entries? (tested, ~no)

Proposal: for each strike/expiry/type, walk the option's ~3-month life, compute
theoretical premium from delta/theta/vega, and find the dates where it equals his
`Buy Avg` / `Sell Avg`.

Computationally fine. It fails on identifiability. Over a 60-session window with
sigma scanned 10-20%, matching within +/-10%:

| entry premium | n | median matching dates | median span (days) | uniquely pinned |
|---|---|---|---|---|
| <Rs1 | 27 | 1 | 0 | 78% |
| Rs1-20 | 59 | 2 | 5 | 58% |
| Rs20-100 | 154 | 3 | 9 | 49% |
| Rs100+ | 47 | 8 | 50 | 21% |

Cheap options look sharply identifiable - but that precision is false. Validated
against the only ground truth available (his 30 dated top profit/loss days):

- 190 uniquely-pinned legs hit a known day **16.3%** vs a **12.5%** base rate
- lift **1.31x**, one-sided binomial **p = 0.073** - not significant
- corr(inferred buy value, recorded) = 0.49 on n=13; **sell side -0.04**

A working method would show signal on both legs. It does not.

**Why it fails: vega cannot be assumed.** IV is the dominant term in a deep-OTM
weekly's premium and swings ~8% to 25%, spiking on exactly the days worth trading.
Too narrow a sigma range and nothing matches (40% of options had no match at any
sigma); too wide and every date matches. Secondly `Buy Avg` is a **blend of fills**
- if he scaled in, no single date is correct, and a "unique" match is then
precisely wrong.

## The version that does work: look the premium up, don't model it

NSE publishes F&O bhavcopy free, no auth (verified 2026-08-24):

    https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_YYYYMMDD_F_0000.csv.zip

2026-07-31 returns 30,456 rows, 1,562 of them NIFTY options, with per-strike
`OpnPric/HghPric/LwPric/ClsPric`, `SttlmPric`, `UndrlygPric`, `OpnIntrst`,
`ChngInOpnIntrst`, `TtlTradgVol`.

The inference then becomes model-free: **a fill at Rs0.60 can only have happened on
a session where `LwPric <= 0.60 <= HghPric`.** No Greeks assumed, no sigma guessed.
It cannot be wrong - only ambiguous - which is the opposite failure mode to the BS
approach. It also yields a real per-strike IV surface, the input missing elsewhere.

Coverage: NSE covers NIFTY (515) + BANKNIFTY (106) + NSE stock options ~= 640 of
1,440 rows. SENSEX (369) and BANKEX (40) need BSE bhavcopy; CRUDEOIL (167) needs
MCX. Backfilling his window is ~240 files, ~7M rows - smaller than `intraday_bars`
today. `scripts/lib/nse.ts` already has the session/cookie handling.

**Still not recoverable even then:** buy-vs-sell direction. Bhavcopy proves a price
existed that day, not which side he took.

---

# Testing R1 (premium ceiling) + R3 (regime filter) on our own data — 2026-08-25

`paper_trades` holds **2 rows**, so there is no paper-trade record to test against.
Substitutes used: `index_prices` (NIFTY 50 **and INDIA VIX**, 2019-09-30 to
2026-08-03) and `fade_outcomes` (49,437 measured mean-reversion trades).

India VIX matters here: it supplies *real* implied vol, so a cheap-option strategy
can be simulated without the option chain we don't have.

## 1. R3 mechanism — CONFIRMED, and the rule as written is wrong

Volatility clusters, strongly. Forward absolute NIFTY move, 1,664 sessions:

| regime | n | E abs 5d | vs baseline | P(abs 5d > 2%) |
|---|---|---|---|---|
| all days | 1664 | 1.72% | 1.00x | 30.8% |
| gap >= 0.8% | 216 | 2.79% | **1.62x** | 47.7% |
| range > 20d avg | 695 | 1.91% | 1.11x | 34.0% |
| **either (R3 as written)** | 803 | 1.94% | 1.13x | 35.0% |
| **both** | 108 | 3.42% | **1.99x** | **53.7%** |
| quiet (stand-down) | 861 | 1.51% | 0.88x | 26.9% |

**R3 specifies OR; it should be AND.** OR gives 1.13x, AND gives 1.99x. The
stand-down half is also right: quiet days deliver 0.88x baseline.

## 2. R1 premium ceiling — REVISED. It is not a standalone rule

Simulated NIFTY option **buys**: entry priced at actual VIX, 5-day hold to expiry,
exit at intrinsic (no vega at exit), 3% round-trip friction, 59,904 legs.

| OTM | median premium | mean return (all days) | mean return (**both** regime) |
|---|---|---|---|
| ATM | 161 | -10.4% | +14.6% |
| 1.0% | 83 | -15.9% | +19.3% |
| 2.0% | 36 | -18.0% | +26.3% |
| 3.0% | 13 | -12.5% | **+29.9%** |

Unconditionally, cheaper OTM is **worse** than ATM. Inside the vol-expansion
regime the ordering **inverts** and cheaper is better. So "buy cheap options" is
not an edge on its own — it is an edge *conditional on regime*. This is the most
useful thing the exercise produced, and it reframes his premium monotonicity:
whatever selected his regime was doing the work, not the cheapness itself.

## 3. Absolute profitability — NOT established

The entire result sits inside the IV assumption. Basket of 1-3% OTM calls+puts:

| IV multiplier on VIX | both-regime mean | quiet mean | spread | bootstrap 95% CI on spread |
|---|---|---|---|---|
| 1.00 | +66.8% | +28.0% | +38.8 | [-22, 101] |
| 1.15 | +24.7% | -23.1% | +47.8 | **[8, 92]** |
| 1.30 | -1.1% | -46.5% | +45.4 | **[15, 80]** |

The **spread** is stable at +39 to +48pp and its CI excludes zero at two of three
assumptions — the regime effect survives. The **level** does not: the strategy
swings from +67% to -1% on an assumption we cannot verify. VIX is 30-day ATM IV
while these are 5-day OTM options, which trade at a skew and term premium, so
1.15-1.30 is the more realistic range — i.e. **breakeven to negative**.

## 4. Independent confirmation from a different strategy

R3 predicts vol expansion helps long gamma and should *hurt* mean reversion. Sign
declared before testing. On `fade_outcomes` (mean excess return, 5-day):

    all days   n=1451   -0.285%
    both       n=  91   -0.449%     <- worse, as predicted
    quiet      n= 762   -0.238%

Different strategy, different data path, predicted direction. That is the
strongest single piece of evidence for the mechanism.

## 5. Caveats that limit all of the above

- **Overlapping windows.** 5-day holds on daily data; 108 both-days is roughly
  **22 independent windows**. The CIs already reflect a day-level bootstrap, but
  this is a small effective sample.
- **Six regime definitions were tested.** The both/quiet contrast was directionally
  pre-declared, but the search is not free.
- **Median return is -103% in every bucket.** Means are tail-driven. Any live
  version needs to survive long losing streaks; this is R5's premium-at-risk
  budgeting, not per-trade stops.
- **R1's original form (never above Rs300) remains untested.** It is a claim about
  his book, and testing it needs real option prices — see the bhavcopy section.

---

# R1 tested on real option prices — 2026-08-25. **R1 is wrong as written.**

`scripts/test-premium-ceiling.py`, against `fo_bhavcopy` (2025-08-01 to 2026-08-03,
41k-47k NIFTY contract-days, volume >= 1000). No model, no IV assumption — these are
traded closes. This is the test the VIX simulation could not settle.

## Buying options loses at every premium level, and cheap is worst

| entry premium | median | 1-day net | 5-day net | 5-day win% |
|---|---|---|---|---|
| <Rs1 | 0.8 | **-50.3%** | **-97.1%** | 0.8% |
| Rs1-5 | 2.2 | -29.7% | -87.6% | 1.1% |
| Rs5-20 | 10.0 | -13.1% | -54.2% | 8.1% |
| Rs20-50 | 32.3 | -7.3% | -26.3% | 19.6% |
| Rs50-100 | 71.6 | -4.0% | -16.2% | 27.7% |
| Rs100-300 | 179.0 | -2.7% | -10.9% | 36.0% |
| **Rs300+** | 473.7 | **-1.1%** | **-4.9%** | 44.4% |

R1 said never buy above Rs300. For a buyer, **Rs300+ is the least bad bucket there
is**, and sub-Rs1 is a near-total loss. The rule is inverted.

## The gradient is days-to-expiry, not premium

Holding moneyness fixed (2-5% OTM) and splitting by DTE, mean buyer return:

| DTE | <Rs5 | Rs5-20 | Rs20-100 | Rs100+ |
|---|---|---|---|---|
| 0-2d | -100.0 | -100.0 | — | — |
| 3-5d | -100.0 | -100.0 | -100.0 | — |
| 6-10d | -91.4 | -83.3 | -79.4 | — |
| 11-20d | -52.8 | -40.1 | -36.5 | -61.5 |
| 21-40d | — | -15.9 | -22.8 | -34.0 |
| 40d+ | — | — | -2.1 | -10.4 |

Rows are close to flat; columns are not. Marginal effects in that band: DTE runs
-100% (0-2d) to -8.1% (40d+); premium runs -93.2% (<Rs5) to -15.6% (Rs100+) but
mostly collapses once DTE is fixed. **Premium was a proxy for time to expiry.**

Partly an artifact: a 5-session hold forces a 2-day option through expiry. Re-run at
1-day holds the ordering survives but compresses (-50.3% vs -1.1%), so the effect is
real and the 5-day numbers overstate it.

## Friction is decisive for cheap options

The tick is Rs0.05, so a Rs0.50 option carries a ~10% spread. Round-trip cost at
1-day holds: **11pp on sub-Rs1** (gross -39.2 to net -50.3) versus **1pp on Rs300+**.
Any backtest of cheap options on close-to-close prices is worthless.

## This closes the direction question

If buying sub-Rs1 options returns **-97%**, then a book that made money on sub-Rs1
options was **selling** them. The economics now agree with the 35 `Buy Avg = 0` rows
and with the 92%-finish-OTM shape. Three independent lines, one conclusion.

His premium monotonicity was never a buyer's edge. It is the seller's side of the
decay this table measures.

## Corrected rules

- **R1 (replaces the Rs300 ceiling):** for BUYING, avoid short-dated OTM entirely —
  the ceiling should be a **DTE floor**, roughly 20+ days. Premium level is not the
  variable.
- **R1b (new):** the sub-Rs5 / short-DTE bucket is a *selling* opportunity, not a
  buying one — but see the tail below before acting on that.
- **R3 stands** as previously tested, with AND not OR.

## The tail a seller carries (2-5% OTM, 5-day)

> SUPERSEDED — these came from a partial backfill. Full-window figures below;
> the sub-Rs5 tail is far worse than this table showed.

    <Rs5     n=3684  mean -93.3%  p99  -12.6%  max   +292.6%
    Rs5-20   n=3537  mean -57.3%  p99 +361.7%  max  +1406.8%
    Rs100+   n=1919  mean -15.6%  p99 +147.7%  max   +234.4%

---

## Confirmation on the complete backfill (261 sessions, 4.14M rows)

Backfill finished 2026-08-25: 2025-08-01 to 2026-08-24, 261 sessions, 16 holidays,
**zero failures**, 240 underlyings. NIFTY option rows 97,717 -> 260,680; the R1 test
sample went 41k -> 97,726 contract-days. Every conclusion holds.

| entry premium | 1-day net | 5-day net | 5-day win% |
|---|---|---|---|
| <Rs1 | -52.7% | -97.7% | 0.3% |
| Rs1-5 | -30.6% | -87.1% | 1.0% |
| Rs5-20 | -14.5% | -54.1% | 7.6% |
| Rs20-50 | -7.4% | -27.0% | 17.1% |
| Rs50-100 | -3.9% | -15.8% | 25.6% |
| Rs100-300 | -1.9% | -6.7% | 35.8% |
| Rs300+ | -1.3% | -2.8% | 44.3% |

### The DTE control is now unambiguous

2-5% OTM, **1-session hold** (no option forced through expiry), mean buyer return:

| DTE | <Rs5 | Rs5-20 | Rs20-100 | Rs100+ |
|---|---|---|---|---|
| 0-2d | -82.9 | -98.4 | -99.5 | — |
| 3-5d | -22.8 | -31.5 | -16.3 | -12.1 |
| 6-10d | -11.1 | -14.3 | -2.6 | -18.6 |
| 11-20d | -2.9 | -6.7 | -5.7 | +1.2 |
| 21-40d | — | -0.1 | -1.6 | -0.7 |
| 40d+ | — | — | -1.3 | -0.4 |

Rows are flat. Columns fall from ~-95% to ~-1%. With the thin cells filled in,
**premium carries no information once days-to-expiry is known.** R1 should be stated
purely in DTE terms.

### CORRECTION — the seller's tail is far worse than first reported

Full window, 2-5% OTM, 5-session, buyer returns (the seller's mirror):

    <Rs5     n=5323  mean -92.6%  p99  -11.7%  max  +3443.1%
    Rs5-20   n=6221  mean -59.6%  p99 +424.5%  max  +2314.7%
    Rs100+   n=5493  mean  -7.0%  p99 +286.0%  max   +568.2%

The partial backfill showed a sub-Rs5 maximum of +292.6% and I described that tail
as bounded. It is not: on the full year the worst session cost a sub-Rs5 seller
**34x the premium collected**. The p99 is still -11.7% — 99% of the time the seller
keeps nearly everything — which is exactly what makes the strategy feel safe right
up until it is not.

**R1b is therefore NOT cleared for use.** Selling short-dated OTM has a positive mean
and an unbounded left tail, in a sample containing no crash. Sizing it by average
outcome would be the same error the trader made in reverse.


---

# Phase A — what climate was he actually trading in? (2026-08-26)

`scripts/resolve-arpan-fills.py`. Fills resolved to candidate sessions by the only
constraint that needs no model: **a fill at Rs0.60 can only have happened on a
session where Low <= 0.60 <= High.** Then `regime_daily` overlaid on those sessions.

830 of 1,440 option rows located in bhavcopy (the rest are BSE/MCX, or expiries
outside the backfill). Among located rows the buy leg pins to **exactly one session
in 62 of 72** cleanly-resolved cases — the lookup is sharp.

## Direction inference failed again, for the third time, and the reason is the same

| status | side | n | net |
|---|---|---|---|
| resolved | LONG | 5 | −92,766 |
| resolved | SHORT | 67 | +407,526 |
| settled | LONG | 11 | −3,820 |
| settled | SHORT | 16 | +70,854 |

Looks decisive. It is not. The circularity check built into the script:

    winners called SHORT: 65/65  (100%)
    losers  called LONG :  5/7   (71%)

On a decaying option the higher price of *any* winner sits earlier in the path, so
ordering the candidate windows separates **profit**, not side. A winning long and a
winning short are not distinguishable this way. Worse, a winning long needs a price
*rise*, which makes its path non-monotonic, which pushes it into the `overlapping`
bucket — so the method cannot even see the cases that would contradict it.

Model-free prices did not fix this, because the confound was never in the model.
**Only the 27 `settled` rows carry uncontaminated direction** (a zero leg is a
settlement, not a fill): 16 SHORT, 11 LONG.

Three methods have now failed on this. Direction is not recoverable from this export.

## The regime overlay, which does not depend on direction

Legs weighted 1 each, split across their candidate sessions, so a smeared row cannot
outvote a pinned one. Reported at four tightness levels:

| pinning | legs | expansion AND | expansion OR | VIX rising |
|---|---|---|---|---|
| exactly 1 session | 529 | **1.47x** | 1.14x | **1.00x** |
| <= 2 sessions | 820 | **1.47x** | 1.14x | 1.04x |
| <= 4 sessions | 1234 | 1.35x | 1.13x | 1.07x |
| all (smeared) | 1643 | 1.30x | 1.13x | 1.07x |

The expansion lift **rises as the pinning tightens** — 1.30 -> 1.35 -> 1.47. That is
the signature of a real effect emerging as measurement noise is stripped out, and it
is the main reason to believe this rather than the smeared version.

VIX level, tightest tranche (his % / baseline %):

    calm 25/38    low 41/32    normal 23/21    elevated 9/6    high 1/3
    mean India VIX 14.74 vs baseline 14.12

## Three conclusions, and they split cleanly

**1. He did select expansion days — 1.47x, and AND again beats OR** (1.47 vs 1.14).
Same ordering found in every other test. The tree's first gate is descriptive of him
*and* predictive.

**2. He did NOT select on VIX direction. Lift 1.00x.** Dead flat against baseline in
the tightest tranche. The tree's second gate — "is India VIX rising or above its
average" — has no basis in his behaviour whatsoever.

**3. He avoided the calmest days** (25% vs 38%) and shifted into low/normal/elevated.
So "stand down on quiet days" is descriptive of him in the *level* sense, not the
direction sense.

## The useful part: what he did and what works are different questions

VIX rising predicts materially better forward outcomes — E abs 5d of 2.93 vs 2.27,
with vega moving the right way (+0.33 vs −1.21). He was not using it.

So the VIX-direction gate should stay in the rule engine, but credited to the
research rather than to him. And the imitation term in the reward doc would, if it
worked at all, actively teach an agent to *ignore* a filter that measures as useful.
