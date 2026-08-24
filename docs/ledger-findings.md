# Ledger Findings — Catalyst Swing Trading

**Date:** 2026-08-04
**Status:** Investigation complete. All catalyst theses tested and closed.

**Corpus**
- 1,324,026 NSE corporate announcements (2015 – Aug 2026)
- 3,224,780 split-adjusted price bars, 3,234 tickers (Oct 2019 – Aug 2026)
- 25,503 corporate actions (846 with price-adjustment factors)
- 169 index series including NIFTY 50
- 2,340 hand-audited order values extracted from announcement PDFs
- 3,218,203 screener indicator rows across 1,773 sessions

**Shared method.** Entry at the close of the first session strictly after the
event; returns close-to-close on split-adjusted prices; excess vs NIFTY 50 over
identical windows; net of 0.35% round-trip cost; liquidity floor ₹5 Cr 20-day
turnover; overlapping events on a ticker collapsed to the first; exchange
surveillance notices excluded.

---

## Verdict

**Catalyst-driven swing trading on Indian corporate announcements is not
executable by a part-time trader. The signal is real; it is fully priced before
any entry point this trader can reach.**

Nine distinct approaches were tested. One produced a validated finding — and it
tells you what *not* to buy rather than what to buy. None produced a tradeable
edge that survived out-of-sample testing.

---

## Why it is not usable

The causal chain, each link measured rather than assumed:

**1. The information is real.** Order announcements move stocks: +0.7% to +1.1%
average excess return on the reaction session, with 54–62% closing up. This is not
noise.

**2. The entire move is the opening auction.** Decomposing that session shows the
whole move is the overnight gap; every event type then drifts *down* intraday,
with only 32–40% closing above their open.

| Event type | Overnight gap | Intraday drift | % up intraday |
|---|---|---|---|
| L1 / bid | **+1.39%** | −0.71% | 32.1% |
| LoI / LoA | **+1.32%** | −0.22% | 39.7% |
| Contract | **+1.21%** | −0.18% | 39.7% |
| Firm order | **+1.07%** | −0.22% | 40.2% |

**3. Therefore no reachable entry captures it.** A GTT placed the previous evening
fills at the open — *after* the gap. Buying at the close means missing the whole
session. Both were tested; both lose.

**4. What follows the gap is negative drift.** Holding 5–10 days after any
reachable entry produces negative excess returns with win rates of 36–45%, against
a routine-filing control of 44.5%.

**5. The bigger the catalyst, the worse it gets.** Perfectly monotonic: the market
prices order size correctly and instantly, and larger gaps mean harder reversals.

**6. Structural constraints close the remaining escape routes.**
- The one positive statistic — mean returns at T+20 and in Defence — comes with a
  *negative median*. That is a positive-skew, lottery-ticket profile requiring many
  simultaneous positions to harvest. The trader is capped at **two**, so he
  experiences the median, not the mean.
- Shorting is the natural response to a reversal pattern, but Indian cash shorting
  is intraday-only; overnight shorts need F&O, and only 41% of the relevant names
  carry the turnover for it.
- Round-trip costs of 0.35% consume what little remains.

This is textbook semi-strong-form efficiency for this class of news. The market is
doing its job; there is no leftover for a part-timer reading alerts in the evening.

---

## Everything we tried

| # | Approach | Hypothesis | Result | Verdict |
|---|---|---|---|---|
| 1 | Buy at **close** of reaction session, hold 5–10d | Catalyst drift continues | mean −0.26% to −0.85% T+5, win 36–45% | ❌ Negative |
| 2 | Buy at **open** of reaction session (evening GTT) | Capture the day-0 move | Whole move is the gap; intraday drift −0.18% to −0.71% | ❌ Unreachable |
| 3 | **Longer hold** (T+20) | Drift needs time to develop | mean **+0.41%**, median **−1.48%** | ❌ Skew, not edge |
| 4 | **Sector restriction** (Defence/Telecom/Infra) | The trader's niche differs | Win rates 38.6–41.2%, *worse* than 44.5% control | ❌ Worse |
| 5 | **Event-type discrimination** (firm order vs LoI vs L1) | Binding orders outperform hype | Inverted — LoI/L1 pop hardest, reverse hardest | ❌ Negative |
| 6 | **Order size** (PDF extraction, 2,340 values) | Big orders relative to company matter most | Monotonic — bigger order → *worse* drift | ⚠️ **Validated, inverted** |
| 7 | **Short the large orders** | Trade the reversal instead | In-sample median +0.89%; OOS mean collapses to +0.07%, T+10 flips sign | ❌ Doesn't survive |
| 8 | **Catalyst as filter** on technical screener | Conditional on a setup, catalyst helps | In-sample +1.68pp edge → **+0.10pp** OOS; T+10 flips sign | ❌ Doesn't survive |
| 9 | **The screener alone** (dma-pullback, RSI, stoch) | Technical setups have edge | Long +0.04% win 46.5%; short −0.13% win 50.5% | ❌ Break-even |

Plus two calibration exercises that were not strategies but made the rest
interpretable:

| | Exercise | Purpose | Finding |
|---|---|---|---|
| A | **Control group** (routine filings: trading windows, newspaper ads) | Isolate structural drag from signal | −0.06% mean, 44.5% win — so ~−0.5% median drag is *structural*, not informational |
| B | **Day-0 decomposition** (gap vs intraday) | Locate where the move happens | 100% of it is the opening gap |

---

## Detailed results

### 1. The reaction day is positive

Excess return on the first session after the filing — the move we do **not**
capture, since entry is at that session's close.

| Event type | n | mean | median | % up |
|---|---|---|---|---|
| LoI / LoA | 566 | **+1.09%** | +0.59% | 59.0% |
| Contract (other) | 2,423 | **+1.04%** | +0.28% | 54.1% |
| Firm order | 1,330 | **+0.80%** | +0.21% | 53.7% |
| L1 / lowest bidder | 174 | **+0.71%** | +0.73% | 62.1% |

The information has value. The question is who captures it.

### 2. Everything after that is negative

| Event type | n | mean T+5 | median T+5 | win% T+5 | median T+10 |
|---|---|---|---|---|---|
| Firm order | 802 | −0.26% | −0.85% | 44.6% | −1.29% |
| Contract (other) | 1,223 | −0.48% | −0.89% | 42.9% | −1.30% |
| LoI / LoA | 354 | −0.72% | −1.47% | 36.2% | −1.81% |
| L1 / lowest bidder | 79 | −0.85% | −1.66% | 36.7% | −1.78% |

Note the inversion: **LoI and L1 have the strongest day-0 pop and the worst
follow-through.** The softest, least binding announcements most reliably give the
move back.

### 3. The control group — how to read these numbers

Routine, information-free filings run through the identical pipeline:

| Group | n | mean T+5 | median T+5 | win% |
|---|---|---|---|---|
| **Control (routine filings)** | 2,951 | −0.06% | −0.54% | 44.5% |
| Firm order | 802 | −0.26% | −0.85% | 44.6% |
| LoI / LoA | 354 | −0.72% | −1.47% | 36.2% |

Two consequences:

1. **A ~−0.5% median drag is structural, not informational.** The median stock
   underperforms a cap-weighted index because the index is carried by a few large
   winners. Every median in this document must be read against this control, never
   against zero.
2. **Against that control, firm orders are neutral and LoI/L1 are genuinely
   worse.** Firm-order win rate (44.6%) is indistinguishable from routine filings
   (44.5%).

### 4. A longer hold does not rescue it

At T+20: mean **+0.41%**, median **−1.48%** (n = 4,374). A few large winners carry
the average. Harvesting that requires many simultaneous positions; the trader is
capped at two.

### 5. The trader's own sectors do not behave differently

| Sector | n | mean T+5 | median T+5 | win% T+5 | mean T+10 |
|---|---|---|---|---|---|
| Telecom | 44 | +0.24% | −1.50% | 38.6% | −0.10% |
| Defence | 221 | −0.06% | −1.21% | 41.2% | **+1.06%** |
| Infrastructure | 569 | −0.61% | −1.06% | 40.2% | −0.70% |
| *Control* | *2,951* | *−0.06%* | *−0.54%* | *44.5%* | — |

All three target sectors have win rates **below** the routine-filing control.
Telecom's n = 44 is too thin to interpret.

Defence at T+10 is the one flicker: mean +1.06%, win 47.3%, p90 +11.92% — but
median −0.73%. Same lottery profile. The Defence list was also enumerated as of
2026 and is therefore survivorship-tilted, so +1.06% is an upper bound.

### 6. The move is entirely in the opening auction

See the table under "Why it is not usable". This is the finding that closes the
last entry point, and it was only visible because daily bars carry open, high, low
and close — the range is symmetric (high +2.32% / low −2.23% on event days vs
+1.98% / −1.96% on ordinary days), meaning event days carry ~17% more volatility
in *both* directions rather than a directional wave.

### 7. Order size predicts the drift — with the opposite sign to intuition

Extracted from 7,325 announcement PDFs (97.5% yielded text; 2,340 high-confidence
values, hand-audited at ~88% precision; residual errors skew *low*, which
attenuates a size effect rather than manufacturing one).

| Order size | Day-0 gap | % gap up | Mean T+10 | Median T+10 | Win% T+10 |
|---|---|---|---|---|---|
| < ₹25cr | +0.10% | 48.5% | **+1.03%** | −0.53% | 46.4% |
| ₹25–100cr | +1.01% | 49.2% | +0.66% | −1.14% | 41.8% |
| ₹100–500cr | +1.10% | 61.0% | −0.92% | −1.63% | 37.5% |
| ₹500–2000cr | +1.57% | 63.9% | −1.47% | −1.74% | 37.5% |
| > ₹2000cr | **+1.88%** | **76.7%** | −1.21% | **−2.57%** | 38.4% |

Monotonic in both directions. **76.7% of ₹2,000cr+ orders gap up** — the market
prices size correctly and instantly — and the larger the gap, the harder the
reversal. Classic overreaction.

**Out-of-sample (train 2019–23, test 2024–26): the gradient holds.** Win rate
declines monotonically on unseen data: 44.0% → 42.3% → 38.4% → **35.8%**.

**The short side does not.** Shorting ₹2,000cr+ announcements looked promising
in-sample (median +0.89%, 55.8% win after costs), but out-of-sample the mean
collapses to **+0.07%**, with T+10 flipping sign between periods (−0.79% train,
+1.31% test) on n = 33/53. A positive median with a zero mean is the signature of
negative skew — win small often, lose big occasionally, the wrong risk profile for
someone who wants consistency.

**Verdict: a validated filter, not a strategy. Order size tells you what not to
buy.** This is the only finding in the project that survived out-of-sample testing.

### 8. Catalyst-as-filter does not survive out-of-sample

The screener in `lib/screener/` was replayed across all 1,773 sessions (11,474
signals, 10,016 priceable), each candidate tagged with whether an order
announcement hit that ticker in the preceding 10 sessions. Both arms share every
convention, so entry timing cannot bias the comparison.

| | n | mean T+5 | median T+5 | win% T+5 |
|---|---|---|---|---|
| No catalyst | 9,721 | −0.03% | −0.22% | **48.1%** |
| Recent catalyst | 295 | **+0.71%** | −0.16% | **48.1%** |

The mean looks encouraging. **The win rate and median are identical** — the entire
difference sits in the tail.

| Period | No catalyst | Recent catalyst | Edge |
|---|---|---|---|
| TRAIN 2019–23 (n=101) | −0.16% | **+1.52%** | +1.68pp |
| TEST 2024–26 (n=194) | +0.19% | +0.29% | **+0.10pp** |

A 1.68pp in-sample edge collapses to 0.10pp out-of-sample; at T+10 it flips sign
(catalyst +0.21% vs no-catalyst +0.29%). Sub-slicing by order size inside the
candidate set leaves n = 21 and n = 71, below the n ≥ 30 actionable threshold.

### 9. The screener itself has no measured edge

Worth stating plainly, since it was the other half of the plan:

| Direction | n | mean T+5 | win% |
|---|---|---|---|
| Long | 5,847 | +0.04% | 46.5% |
| Short | 3,874 | −0.13% | 50.5% |

Break-even to slightly negative after costs. **The thing the catalyst was meant to
filter does not itself clear the bar.**

---

## Why these numbers can be trusted

Every result above is negative or inverted, so the natural question is whether the
pipeline is simply broken. These checks were run specifically to rule that out:

- **Return arithmetic hand-verified.** NBCC, 2020-07-28: adjusted close 16.067 →
  15.367 = −4.36%; NIFTY 11300.6 → 11095.3 = −1.82%; excess after 0.35% cost =
  −2.89%. Matches the stored value exactly.
- **Split adjustment verified.** Every 10:1 split shows ~−90% raw gap and ~0%
  adjusted gap (NESTLEIND −90.2% → −1.7%; SAREGAMA −90.0% → −0.1%).
- **Split dates derived from price data, not metadata.** NSE's stated ex-date is
  one session early in **470 of 476 cases**; keying on it would have injected a
  fake ±900% bar into hundreds of series. Also rejected 10 corporate actions that
  were recorded but never affected prices.
- **A control group calibrates the baseline.** Without it, the −0.5% structural
  median drag would have been misread as a catalyst effect.
- **Look-ahead guarded.** Entry strictly after `announced_at`; filings after 15:30
  IST skip a day. Exchange surveillance categories (`Price movement`, `Spurt in
  Volume`, `News Verification`) excluded — they are the exchange reacting to a move
  that *already happened*, and were **46% of naive keyword hits**.
- **Indicators verified to 0.00000000 MAE** against an independent SQL
  window-function computation.
- **Every candidate finding was train/test split.** Two of them (short side,
  catalyst filter) looked like real edges in-sample and were killed by it.
- **Order values carry evidence snippets.** Every extracted figure is traceable to
  the sentence it came from; three hand-audits drove precision from ~65% to ~88% by
  eliminating company boilerplate, penalties/bank guarantees, missed USD
  conversions, and non-monetary quantities ("2.3 million sq ft").

## Bugs found and fixed along the way

1. **NSE ex-date off by one session** (470/476) — would have corrupted every
   return spanning a split.
2. **The live screener ran on insufficient price history.** `indicators` held one
   date computed from prices starting 2025-06-10; **451 tickers had less history
   than a single indicator window.** EMA50 needs 50 bars to seed and Wilder's RSI
   is path-dependent, so `weeklyTrend` — which gates *every* setup — was wrong for
   **134 of 1,266 tickers (~1 in 10)**.
3. **BSE ingestion has never returned a row.** `lib/ingestion/bse.ts` uses plain
   fetch; BSE soft-blocks non-browser clients with `"No Record Found!"` and HTTP
   200. Dropped in favour of NSE, which supplies the ticker symbol directly.

---

## What remains genuinely untested

Stated honestly. None of these rescue the general case; any could rescue a narrow
one, and each carries a poor prior given the results above.

1. **Intraday data.** Daily bars bound the range but not the *path*. The symmetric
   high/low argues against an early-pop-then-fade pattern but does not disprove it.
   Testing needs 5/15-minute data (broker API or paid vendor) — and any strategy it
   found would require trading at 9:15 AM, which is the constraint the whole system
   exists to avoid.
2. **Order value ÷ revenue.** Absolute size was tested; the revenue-normalised
   ratio was not. Requires ~28,000 XBRL filings. Deprioritised because absolute size
   already produces a clean monotonic gradient whose sign is established and
   unprofitable to trade.
3. **LLM event classification.** Typing is regex-based; precision is likely 50–80%,
   which dilutes every bucket. Would sharpen the estimates, not reverse them.
4. **The existing 1–10 `impactScore`.** Never tested — `events` holds only 11 rows,
   so the scorer would have to be run across the corpus first. Given that event
   type, sector and order size all fail to predict, a keyword-weighted composite of
   the same inputs is unlikely to succeed.
5. **Other data families entirely** — options flow, institutional holdings changes,
   promoter pledge changes, block/bulk deals. Untouched.

---

## What the work produced

Even with a negative headline, these are durable:

- **A verified 7-year research database** — announcements, adjusted prices,
  corporate actions, index history, order values, screener indicators — that can
  answer new questions in minutes rather than weeks.
- **One validated finding**: order size as a *don't-buy* signal, the only result
  that survived out-of-sample testing.
- **Three production bugs found and fixed**, two of which were silently corrupting
  the existing system.
- **A methodology that catches its own false positives.** Four separate apparent
  edges (short side, catalyst filter, Defence T+10, small-order T+10) were killed
  by controls or train/test splits. That discipline is the reason no capital was
  committed to a 1.68pp edge that was really 0.10pp.

## Recommendation

**Stop building on the catalyst thesis.** It has been tested as a trigger, across
horizons, by sector, by event type, by order size, on the short side, and as a
filter. Every route is closed with data.

Further slicing of this dataset is data-dredging: enough comparisons have now been
run that any new "discovery" would need a substantially higher bar to be credible.

If work continues, it should be on a **genuinely new data source** (intraday,
options flow, holdings) or a **different strategy family** — not more cuts of this
one.
