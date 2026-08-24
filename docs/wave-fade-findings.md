# Wave-Fade Findings — Momentum Exhaustion Research

**Date:** 2026-08-04
**Status:** Tested. Negative — but with a more precise answer than the catalyst work.
**Predecessors:** [ledger-findings.md](ledger-findings.md), [outcome-ledger.md](outcome-ledger.md)

> **Note on spec.** The handover document was truncated mid-sentence at §4.3, before
> stating the exhaustion threshold, and §4.4+ (risk rules, holding period, reporting
> format) were absent. Rather than guess one threshold, `body_ratio` was **swept**
> across 0.15–0.50. Everything else follows §2–§3 verbatim.

---

## Verdict

**The plain wave-exhaustion signal is real but ~3× too small to pay for execution.
Adding volume confirmation produces a genuinely strong, out-of-sample-stable effect
— which lives almost entirely in stocks too illiquid to trade it in.**

Three findings, in order of importance:

1. **Plain fade (Variant A)**: beats a random entry by ~**+0.11pp** at T+5 against
   a **0.35%** cost. Real, consistently signed, a third of the size needed.
2. **Gap context (Variant B)**: **substantially worse**, contradicting its own
   hypothesis.
3. **Volume-confirmed fade of an up-wave (≥4× average volume)**: mean **+1.29%**
   train → **+1.66%** test, win rate **61.5% → 62.0%**, positive in every full year.
   **The first result in this entire project to survive out-of-sample testing.**
   Then: it is monotonically stronger the *less* liquid the stock, and the tradeable
   tranche collapses to n=32.

---

## The control validates the pipeline

Before any signal result, the control deserves attention on its own:

| Random liquid stock-days | n | mean T+5 | median T+5 | win% |
|---|---|---|---|---|
| Long | 13,901 | **−0.347%** | −0.775% | 42.7% |
| Short | 13,901 | **−0.353%** | +0.075% | 50.7% |

A zero-information entry earns **exactly −0.35%**, which is precisely the round-trip
cost. Gross excess return of a random trade is ~0.00%, as it must be.

This is the cleanest sanity check in either study: the measurement pipeline has no
systematic bias in either direction, so every number below can be read as a genuine
deviation from chance.

---

## Variant A — pure technical exhaustion

Signals: 103,924 wave-exhaustion events detected across 3,084 tickers; 49,243
priced after the ₹5 Cr liquidity floor.

At `body_ratio < 0.30`:

| Fade | n | mean T+5 | median T+5 | win% | vs control |
|---|---|---|---|---|---|
| Long (after down-wave) | 9,017 | −0.235% | −0.696% | 43.4% | **+0.11pp** |
| Short (after up-wave) | 9,160 | −0.229% | +0.254% | 52.4% | **+0.12pp** |

Both beat their control, both remain net negative. **Gross alpha is roughly
+0.12%; the cost is 0.35%.**

### Threshold sweep — the exhaustion candle does carry information

| body_ratio < | down: mean / win | up: mean / win |
|---|---|---|
| 0.15 | **−0.150% / 44.4%** | **−0.147% / 52.9%** |
| 0.20 | −0.204% / 43.7% | −0.222% / 52.6% |
| 0.25 | −0.260% / 43.4% | −0.200% / 52.7% |
| 0.30 | −0.235% / 43.4% | −0.229% / 52.4% |
| 0.40 | −0.246% / 43.1% | −0.246% / 52.2% |
| 0.50 | −0.295% / 42.8% | −0.243% / 52.1% |

There **is** a gradient: the tightest threshold is the best cell in both directions,
and win rate declines monotonically as the filter loosens (44.4 → 42.8 down;
52.9 → 52.1 up). So a smaller body genuinely does mark weaker momentum.

But the gradient is worth only ~0.10–0.15pp of mean and ~1.5pp of win rate across
the entire range. Even the strictest cut (0.15) is net negative.

---

## Variant B — gap-context exhaustion

Hypothesis: the pattern should be *stronger* when the wave began with a large gap,
building on the earlier finding that large gaps reverse harder.

| Fade | n | mean T+5 | median T+5 | win% | mean T+10 |
|---|---|---|---|---|---|
| Long (after down-wave) | 108 | **−2.531%** | −2.152% | 33.3% | −2.085% |
| Short (after up-wave) | 231 | **−1.190%** | +1.149% | 54.1% | −1.014% |

**The opposite of the hypothesis.** Gap context makes the fade dramatically worse —
−2.53% and −1.19% against Variant A's −0.235% and −0.229%.

Interpretation: a wave that *starts* with a large gap is a genuine repricing with
follow-through, not an overextension. Fading it means fighting a real trend. Note
this is not in tension with the earlier catalyst finding — there, large gaps
reversed when they were a *reaction to news*; here the gap initiates a multi-day
directional move.

Sample sizes (108 / 231) are thin, but the effect is large and consistently signed
across both directions and both horizons.

---

## Secondary cuts

**Wave length** — no consistent gradient. Down-waves improve slightly with length
(−0.240% at 3 sessions → −0.017% at 6+), up-waves get *worse* (−0.181% → −0.416%).
Opposite signs means noise.

**Wave extension (total move)** — down-waves show a gradient, up-waves do not:

| Extension | down: mean / win | up: mean / win |
|---|---|---|
| < 5% | −0.306% / 42.2% | −0.271% / 51.2% |
| 5–10% | −0.254% / 43.4% | −0.181% / 52.4% |
| 10–15% | −0.014% / 46.0% | −0.231% / 53.5% |
| 15%+ | **+0.017%** / 48.0% | −0.222% / 54.7% |

One cell is positive: down-wave, move ≥15%, n=410, mean **+0.017%**.

**This should not be treated as a finding.** It is statistically indistinguishable
from zero, and by this point roughly 40 cells have been examined (6 thresholds × 2
directions, plus Variant B, plus out-of-sample, plus 4 length buckets × 2, plus 4
extension buckets × 2). Finding one cell at +0.017% is exactly what noise produces
at that many comparisons. Acting on it would be textbook data-dredging.

---

## Volume-confirmed exhaustion — the one real finding

Separating climax/blow-off candles from low-volume drift, using signal-day volume
÷ 20-day average volume. At `body_ratio < 0.30`:

| Volume | down: mean / win | up: mean / win |
|---|---|---|
| quiet < 0.8× | −0.350% / 41.9% | −0.108% / 52.2% |
| normal 0.8–1.2× | −0.104% / 45.1% | −0.199% / 53.1% |
| elevated 1.2–2× | +0.501% / 47.9% | −0.584% / 51.4% |
| high 2–3× | −0.113% / 46.9% | −0.800% / 50.3% |
| **climax 3×+** | −1.562% / 45.9% | **+0.540% / 58.4%** |

The up-wave climax cell is the standout, and it fits the mechanism precisely: a
blow-off top on extreme volume is genuine exhaustion. The down-wave equivalent is
the *worst* cell in the table (−1.562%) — economically sensible, since climax volume
on a decline is panic that tends to continue.

### The effect concentrates above 4×, not 3×

| Volume (up-wave) | n | mean T+5 | median T+5 | win% |
|---|---|---|---|---|
| < 2× | 8,201 | −0.226% | +0.224% | 52.3% |
| 2–2.5× | 366 | −0.250% | +0.177% | 50.8% |
| 2.5–3× | 199 | **−1.812%** | −0.286% | 49.2% |
| 3–4× | 180 | −0.541% | +0.589% | 54.4% |
| **4–5×** | 87 | **+2.010%** | **+3.551%** | **62.1%** |
| **5×+** | 127 | **+1.067%** | **+2.765%** | **61.4%** |

Note this is **not a monotonic gradient** — 2.5–3× is the worst bucket in the whole
study. A blow-off is plausibly a threshold phenomenon rather than a continuum, but
the non-monotonicity is a genuine reason for caution.

### It survives out-of-sample (≥4×)

| Period | n | mean T+5 | median T+5 | win% | mean T+10 |
|---|---|---|---|---|---|
| TRAIN 2019–23 | 122 | +1.290% | +3.290% | 61.5% | +2.262% |
| TEST 2024–26 | 92 | **+1.662%** | +2.804% | **62.0%** | +1.201% |

Test is as good as or better than train on every measure. Year by year, the mean is
positive in 6 of 7 meaningful years and **the win rate never falls below 50% in any
full year** (51.6% – 69.6%).

This is the only result in either study to clear that bar.

### Why it still cannot be traded

| Liquidity at entry | n | mean T+5 | median T+5 | win% |
|---|---|---|---|---|
| **Liquid — turnover ≥ ₹100cr** | **32** | **+0.426%** | +0.739% | **53.1%** |
| Mid — ₹25–100cr | 47 | +1.162% | +2.419% | 66.0% |
| Thin — ₹5–25cr | 135 | **+1.793%** | +3.927% | 62.2% |

**The effect is monotonically stronger the less liquid the stock.** That is the
signature of a limits-to-arbitrage / illiquidity premium: it persists precisely
where capital cannot reach it.

Three consequences, each independently disqualifying:

1. **It is a short.** Indian cash shorting is intraday-only; holding overnight needs
   F&O, which the thin and mid tranches do not have.
2. **The tradeable tranche is n = 32** with a much weaker effect (+0.43%, 53.1%) —
   far below any actionable threshold.
3. **The 0.35% cost assumption is far too generous for the thin tranche.** Shorting
   a ₹5–25cr-turnover stock into a 4× volume blow-off would plausibly cost 1–2% in
   spread and impact, which consumes the entire +1.79%.

The honest summary: this is a **real market phenomenon**, correctly identified and
validated. It is not a strategy available to this trader.

## Out-of-sample

At `body_ratio < 0.30`:

| Period | down: mean / win | up: mean / win |
|---|---|---|
| TRAIN 2019–23 | −0.088% / 44.9% | −0.398% / 52.0% |
| TEST 2024–26 | −0.362% / 42.1% | −0.056% / 52.8% |

**Signs move in opposite directions between periods** — down-waves get worse, up-waves
get better. No stability. The +0.11pp average edge is stable in *aggregate* but not
decomposable into anything a trader could lean on.

---

## Why this is not usable

1. **The edge is real but sub-cost.** +0.12% gross against 0.35% round-trip. This is
   the crispest result in either study: the pattern exists and is measurable, and it
   is about a third of the size needed.
2. **Costs would have to fall ~3×** to make it viable — meaning a discount broker,
   larger position sizes to dilute fixed costs, and liquid names with tight spreads.
   Trading it in the ₹5 Cr-turnover band that produced these numbers is not viable.
3. **The short leg carries the familiar asymmetry.** Fading up-waves wins 52.4% of
   the time with a *positive* median (+0.254%) but a negative mean — win small often,
   lose big occasionally. It also requires overnight shorting, which in India needs
   F&O.
4. **Variant B is actively harmful**, so the one contextual filter proposed makes
   things worse rather than better.
5. **No out-of-sample stability** in the directional decomposition.

---

## What would change the answer

Honestly stated, in descending order of plausibility:

1. **Lower costs.** The entire gap is execution cost. At 0.10% round-trip the signal
   is marginally positive. This is the only lever that closes a 3× gap.
2. **Intraday exit.** All measurement here is close-based. If the fade's edge is
   concentrated in the first hours after the open, an intraday exit could capture
   more of it at lower risk — but that needs intraday data and market-hours attention.
3. **A tighter exhaustion definition.** The sweep shows the gradient continues to
   improve below 0.15; it was not tested further because cells thin out. Worth one
   run at 0.05/0.10 — though extrapolating the observed slope suggests it closes
   perhaps a third of the gap, not all of it.
4. ~~**Volume confirmation.**~~ **Tested — see above.** It works, survives
   out-of-sample, and is unreachable because the effect lives in illiquid names on
   the short side.

### The one thread still worth pulling

The volume-confirmed effect is strong in the **mid tranche (₹25–100cr turnover):
+1.16% mean, +2.42% median, 66.0% win, n=47.** Some of those names do have F&O.
Isolating F&O-eligible stocks specifically — rather than proxying eligibility by
turnover — would establish whether a tradeable subset exists at all. It requires the
NSE F&O eligibility list by date, which is not currently in the database.

Expect this to fail: n would be a fraction of 47, and the liquidity gradient implies
the effect weakens exactly as tradeability improves. But it is the only remaining
route from "real phenomenon" to "executable trade", and it is a bounded piece of work.

## Method notes

- Wave: ≥3 consecutive higher-high **and** higher-low (or lower-high and lower-low),
  detected on split-adjusted OHLC. Unadjusted prices would manufacture a spurious
  wave day at every split.
- Entry: **next session's open**, as specified.
- **Index opens were backfilled for this study.** The catalyst ledger had to use
  close-to-close because only index closes were stored; mixing an open-entry stock
  leg with a close-entry index leg biases every excess return by one overnight gap.
  `index_prices` now carries open/high/low for all 1,689 NIFTY 50 sessions, so both
  legs here are measured open-to-close. This resolves a limitation documented in the
  previous study.
- Returns: excess vs NIFTY 50 over identical windows, net of 0.35% round-trip.
- Direction: shorts are signed before costs, so a short profits when the stock
  underperforms the index.
- Liquidity floor: ₹5 Cr 20-day average turnover.
