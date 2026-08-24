# Intraday Gap-Fade Findings

**Date:** 2026-08-04
**Status:** **First viable candidate found.** Survives out-of-sample, survives in
liquid names, and is executable under the relaxed attention constraint.
**Predecessors:** [ledger-findings.md](ledger-findings.md),
[wave-fade-findings.md](wave-fade-findings.md), [outcome-ledger.md](outcome-ledger.md)

> **Scope limit.** Opening-range breakout and first-30/60/90-minute behaviour
> require intraday bars, which do not exist in this database (NSE publishes no
> intraday archive). What daily OHLC *can* answer is the core of the brief: gap
> size, and the full **open → close** move. That is the intraday fade, squared off
> before close, exactly as specified.

---

## Verdict

**Fading an opening gap intraday works, and unlike every previous finding it
survives in stocks liquid enough to trade.**

| | Gross | Win% | Net @ 20bps | Net @ 40bps |
|---|---|---|---|---|
| All liquid (≥₹5cr), gap ≥3% | +1.24% | 66% | +1.04% | +0.84% |
| **Executable tranche (≥₹100cr turnover)** | **+0.44%** | **58%** | **+0.24%** | **+0.04%** |

The edge is monotonic in gap size, holds in both directions, survives
out-of-sample, and was positive in **80 of 83 months**.

It is also **thin in the tranche that matters** and rests on one unvalidated
execution assumption (see "The assumption that decides everything").

---

## The baseline that governs this study

Before any signal: individual liquid stocks drift **down** from open to close.

| | Value |
|---|---|
| Avg stock open→close | **−0.1905%** |
| Avg NIFTY open→close | −0.0426% |
| **Avg excess** | **−0.1479%** |
| Stocks beating the index intraday | 42.7% |

So **shorting a random liquid stock at the open and covering at the close earns
+0.148% excess, for free, with no signal at all** (n = 1,382,868).

Every number below is reported as an edge *over this baseline*. Without it, the
market's structural intraday drift would be miscredited to the strategy — which
would have inflated the headline by roughly a third.

---

## Result 1 — up-gap fade (short at open, cover at close)

| Gap | n | Gross | Net @20bps | Edge over baseline | Win% |
|---|---|---|---|---|---|
| 1–2% | 142,557 | +0.407% | +0.207% | +0.259% | 63.1% |
| 2–3% | 34,224 | +0.723% | +0.523% | +0.575% | 65.7% |
| 3–5% | 20,767 | +0.920% | +0.720% | +0.772% | 63.8% |
| 5–7% | 4,040 | +0.963% | +0.763% | +0.816% | 64.0% |
| 7–10% | 1,924 | +1.622% | +1.422% | +1.474% | 64.7% |
| **10%+** | 944 | **+3.269%** | +3.069% | +3.122% | **68.3%** |

Monotonic, net positive in every bucket, win rates 63–68%, on very large samples.

## Result 2 — down-gap fade (long at open, sell at close)

| Gap | n | Gross | Net @20bps | Edge over baseline | Win% |
|---|---|---|---|---|---|
| −1 to −2% | 57,538 | +0.321% | +0.121% | +0.468% | 53.7% |
| −2 to −3% | 18,190 | +0.565% | +0.365% | +0.713% | 57.6% |
| −3 to −5% | 12,650 | +0.782% | +0.582% | +0.930% | 58.5% |
| −5 to −7% | 3,157 | +0.908% | +0.708% | +1.055% | 60.3% |
| −7 to −10% | 1,874 | +1.539% | +1.339% | +1.687% | 65.4% |
| **−10%+** | 1,552 | **+3.560%** | +3.360% | +3.708% | **66.9%** |

Both directions work. The long side is *helped* more by the baseline adjustment
(it fights the −0.148% drift rather than riding it), so its edge over baseline is
actually larger than the short side's.

## Result 3 — the volume filter is essential, and inverts the previous finding

Up-gaps ≥3%, split by volume vs 20-day average:

| Volume | n | Gross | Win% |
|---|---|---|---|
| < 2× | 18,103 | **+1.598%** | **70.0%** |
| 2–4× | 4,791 | +1.117% | 61.5% |
| **4×+** | 4,781 | **−1.062%** | **44.1%** |

**High-volume gaps do not fade — they continue.** A gap on 4× volume is genuine
repricing (news, institutional flow) with follow-through; a gap on quiet volume is
noise that reverts.

This is the **opposite** of the volume-climax finding in
[wave-fade-findings.md](wave-fade-findings.md), and both are economically coherent:
there, extreme volume marked a *blow-off after a multi-day run* (exhaustion); here
it marks the *start* of a repricing (initiation). Volume means exhaustion at the
end of a move and conviction at the beginning of one.

> ### ⚠️ CORRECTION — this filter is NOT executable
>
> The ratio above divides by **full-day** volume, which does not exist at 09:15
> when the order is placed. Using it live would be look-ahead bias.
>
> The tradeable substitute — **prior-day** volume ratio, known at the open — is far
> weaker: +1.106% (<2×) → +0.932% (2–4×) → +0.664% (4×+). A mild gradient, and it
> does not identify the disaster cases.
>
> **The volume result stands as an explanation of *why* gaps fade or continue. It
> does not stand as a tradeable filter.** All liquidity-tranche and out-of-sample
> numbers in this document were computed *without* any volume filter, so they
> remain valid as executable expectations.

---

## Result 4 — out-of-sample

Gap ≥5%, all liquid:

| Period | n | Gross | Net @20bps | Win% |
|---|---|---|---|---|
| TRAIN 2019–23 | 3,551 | +2.150% | +1.950% | 69.1% |
| TEST 2024–26 | 3,357 | +0.735% | +0.535% | 60.2% |

Positive in both, but a **substantial decay** — roughly two-thirds of the edge is
gone. Either the effect is being arbitraged away, or the 2020–22 volatility regime
was unusually favourable. Both are plausible; the honest planning assumption is the
test-period number, not the full-sample one.

## Result 5 — it survives in liquid names (the test that killed the last finding)

Gap ≥3%, by turnover at signal:

| Liquidity | n | Gross | Net @20bps | Net @40bps | Win% |
|---|---|---|---|---|---|
| Thin ₹5–25cr | 15,905 | +1.382% | +1.182% | +0.982% | 67.5% |
| ₹25–50cr | 3,882 | +0.972% | +0.772% | +0.572% | 63.0% |
| ₹50–100cr | 2,517 | +0.643% | +0.443% | +0.243% | 59.6% |
| **₹100–200cr** | 1,750 | **+0.481%** | +0.281% | +0.081% | 58.9% |
| **>₹200cr** | 2,494 | **+0.402%** | +0.202% | +0.002% | 57.3% |

The familiar gradient — stronger where it is harder to trade. **But unlike the
volume-climax finding, the liquid tranche still works**: +0.4–0.5% gross at 57–59%
win rates on ~4,200 observations.

And it holds out-of-sample within that tranche:

| Liquid names only (≥₹100cr) | n | Gross | Win% |
|---|---|---|---|
| TRAIN 2019–23 | 1,809 | +0.533% | 59.0% |
| TEST 2024–26 | 2,435 | +0.361% | 57.1% |

This is the first result in the entire research programme to clear this bar.

---

## Risk profile — where it fails

83 months, gap ≥3%, excluding circuit-locked days:

| Month type (by signal count) | months | Avg gross | Avg win% | Worst month |
|---|---|---|---|---|
| Calm (<250 signals) | 38 | +1.249% | 65.3% | −0.119% |
| 250–500 | 36 | +1.311% | 67.2% | +0.286% |
| 500–800 | 4 | +1.196% | 66.3% | +0.952% |
| **Stress (800+ signals)** | **5** | **+0.672%** | **59.7%** | **−0.817%** |

**Only 3 of 83 months were negative.** But the failure mode is clear and it is the
one that matters: the strategy is weakest exactly when it fires most.

The worst month, **April 2026**, produced **1,551 signals (≈5× normal) at −0.817%
and a 42.9% win rate.** In a market-wide volatility event, gaps continue rather
than revert, and the signal count explodes at the same moment.

Two mitigations fall out naturally:
- The **2-position cap protects here**. He takes 2 trades regardless of whether the
  day offers 60 signals or 600, so the exposure spike does not translate into a loss
  spike.
- The **≥4× volume exclusion** should remove much of the stress-month damage, since
  crisis gaps are high-volume by construction. This is untested as an interaction
  and should be verified.

Note also **2026 year-to-date is roughly flat** (−0.094%) driven almost entirely by
April. Seven of eight months in 2026 were positive.

---

## The assumption that decides everything

**Every number in this document assumes a fill at the opening price.**

Bhavcopy's `open` is the opening-auction price. Capturing it requires a
market-on-open order, and the study cannot verify what would actually be filled,
because that needs intraday data. Specific concerns:

1. **Slippage is highest at the open**, and highest of all in a stock that gapped.
2. **Spreads are widest at the open** — in the ₹5–25cr tranche (where the effect is
   strongest) this could exceed the entire edge.
3. **Circuit locks**: 1.6–4.9% of gap days had effectively no intraday range, and
   14–17% of extreme-gap days closed at their high — those are unshortable or
   painful. They are already inside the averages, but a live system must detect and
   skip them.
4. **Short availability**: intraday cash shorting *is* permitted in India, so the
   mechanism is legal and available. This is the constraint change that made the
   whole study viable.

At 40bps the liquid tranche is roughly break-even. **The strategy's viability is
decided by execution quality, not by the signal.**

---

## Result 6 — the tail, and what it does to position sizing

Trade-level distribution, liquid tranche, gap ≥3%, net of 20bps:

| n | mean | p01 | p05 | median | p95 | worst | win% |
|---|---|---|---|---|---|---|---|
| 8,254 | +0.359% | **−13.05%** | −6.23% | +0.37% | +7.03% | **−51.91%** | 55.0% |

The worst trades are real, not data errors — YESBANK, INDUSINDBK, IDEA and
BANDHANBNK in March 2020, each gapping and then running a further 35–50% intraday.

**The tail cannot be filtered out at the open.** Splitting by market-wide stress
(the index's own gap, knowable at 09:15):

| Market state | n | mean | p01 | worst | win% |
|---|---|---|---|---|---|
| Calm (index gap <0.75%) | 3,464 | +0.296% | −14.22% | −27.71% | 54.0% |
| Moderate 0.75–1.5% | 1,295 | +0.390% | −9.35% | −47.38% | 56.1% |
| Stress ≥1.5% | 3,495 | **+0.410%** | −11.11% | −51.91% | 55.6% |

Stress days carry the *highest* mean, and every regime carries a double-digit p01.
The tail is **idiosyncratic** — single-stock events — not market-wide, so no
regime filter reaches it.

### The consequence

Surviving a −52% trade on 1% capital risk caps position size at roughly **2% of
capital**. At +0.36% mean that is +0.007% of capital per trade, or about **+2.5%
a year** — not worth the attention.

The strategy is therefore **only meaningful with a stop loss**, and a stop is
precisely what daily bars cannot test: there is no way to know whether price
touched −5% before closing +1%. Worse, gap-fade shorts are exactly the trades
where a stop gets blown through (YESBANK ran +44% intraday).

**This makes intraday data a prerequisite for deployment, not an enhancement.**

## Result 7 — the stop works. The edge is decaying faster than the stop can help.

Tested with hourly bars from yfinance (2 years, 706 tickers, 2.1M bars), using a
deliberate hybrid: **entry and exit from bhavcopy** (exact opening-auction and
closing prints), **intraday path from Yahoo high/low** (validated to ~0.03% against
bhavcopy; Yahoo's own open/close carry 0.1–0.4% error and are never used).

Stop fills are penalised — assumed to fill worse than the trigger — because in the
runaway moves a stop exists to protect against, slippage is worst.

### The stop mechanism works exactly as hoped

n = 3,206 signals, 0.3% stop slippage:

| Stop | mean | median | win% | p01 | worst | stopped% |
|---|---|---|---|---|---|---|
| **none** | +0.513% | +0.53% | 56.4% | **−11.29%** | **−21.95%** | — |
| 2% | +0.451% | −0.13% | 49.0% | −2.51% | −2.51% | 39.2% |
| 3% | +0.477% | +0.27% | 53.1% | −3.51% | −3.51% | 26.3% |
| **5%** | **+0.486%** | +0.43% | 55.3% | **−5.52%** | **−5.52%** | 12.3% |
| 7% | +0.461% | +0.47% | 55.9% | −7.52% | −7.52% | 6.4% |
| 10% | +0.469% | +0.51% | 56.1% | −10.53% | −10.53% | 2.7% |

**A 5% stop cuts the worst case 4× (−21.95% → −5.52%) while costing only 0.027% of
mean return.** It fires on 12.3% of trades. A 2% stop is too tight — it turns the
median negative and drops the win rate to 49%, cutting winners rather than losers.

This resolves the sizing constraint that made the strategy pointless: at 1% capital
risk, position size rises roughly 4× because the tail is 4× smaller. The mechanism
is robust to slippage — at 0.6% it still returns +0.449%.

### But the underlying edge has collapsed out-of-sample

| Period | stop | n | mean | median | win% |
|---|---|---|---|---|---|
| **TRAIN Aug24–Aug25** | none | 1,516 | **+0.956%** | +0.88% | 60.2% |
| | 5% | 1,516 | +0.925% | +0.77% | 59.0% |
| **TEST Aug25–Aug26** | none | 1,690 | **+0.116%** | +0.23% | 52.9% |
| | 5% | 1,690 | +0.093% | +0.19% | 52.1% |

**The edge fell 88% between the two years.** The stop behaves identically in both —
that mechanism is validated twice over — but there is progressively less left for it
to protect.

### The decay is monotonic across every window measured

| Window | mean excess |
|---|---|
| 2019–2023 (gap ≥5%) | **+2.150%** |
| 2024–2026 (gap ≥5%) | +0.735% |
| Aug 2024–Aug 2025 (gap ≥3%) | +0.956% |
| **Aug 2025–Aug 2026 (gap ≥3%)** | **+0.116%** |

Thresholds differ slightly between rows, so these are not strictly comparable — but
the direction is unambiguous and matches the earlier month-by-month analysis showing
2026 roughly flat. This is the signature of an anomaly being arbitraged away, not of
a stable edge.

At +0.093% net per trade and a **52.1% win rate**, the most recent twelve months are
close to a coin flip. That is not a foundation for a strategy whose stated goal is
consistency.

**Verdict: the stop question is answered — yes, 5% works, and it is the right design.
But it arrives at a strategy that has largely stopped paying.**

## Result 8 — why it decayed: crowding, not regime

Two hypotheses were tested against each other. They make different predictions, so
the data can separate them.

### It is not a volatility regime

Mean net return, conditioned on NIFTY 20-day realised volatility:

| Vol regime | 2019–21 | 2022–23 | 2024–25 | **2025–26** |
|---|---|---|---|---|
| Low | +0.147 | +0.396 | +0.734 | **−0.501** |
| Mid | +0.134 | +0.433 | +0.938 | **+0.141** |
| High | +0.646 | +0.046 | +0.392 | **−0.546** |

**2025–26 is the worst era in every volatility bucket**, including high-vol — where
the regime hypothesis predicts the fade should work best. Average gap size is stable
across eras (4.2–5.5%), so gaps did not shrink. Regime is ruled out.

Note also the edge *grew* from 2019–21 through 2024–25 before collapsing. This is a
**structural break around Aug 2025**, not a gradual decay.

### It is not a data artifact

Market-wide intraday drift (all liquid stocks, no signal), excess vs NIFTY:

| 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|
| −0.064 | −0.133 | −0.043 | −0.125 | −0.108 | −0.064 |

Stable. The 2026 shift accounts for roughly 5% of an 0.8pp collapse. The
gap-specific edge genuinely broke.

### It is crowding — the profit has been pulled forward

Cumulative fade from the open, by hour (positive = fade paying):

| Exit at end of | 2024–25 | 2025–26 | change |
|---|---|---|---|
| **Hour 1** | +0.554 | **+0.662** | **+0.108** |
| Hour 2 | +0.617 | +0.560 | −0.057 |
| Hour 4 | +0.354 | +0.242 | −0.112 |
| Hour 6 | +0.631 | +0.371 | −0.260 |
| **Close** | **+0.691** | **+0.353** | **−0.338** |

The first hour got **stronger**; every later hour got **weaker**, monotonically
widening through the session. In 2024–25 the fade kept building all day
(0.554 → 0.691); now it peaks in hour one and gives back half by the close
(0.662 → 0.353).

That is the signature of an anomaly being competed away: profit compresses toward
the earliest moment it can be captured, and holding longer stops paying.

### But exiting early does not rescue it

With **both legs benchmarked against NIFTY over identical windows**, net of costs:

| Era | n | exit hour 1 | win% | exit close | win% |
|---|---|---|---|---|---|
| 2024–25 | 1,528 | +0.319 | 67.1% | **+0.852** | 62.0% |
| 2025–26 | 1,683 | **+0.150** | **52.9%** | **−0.259** | 46.7% |

Hour-1 exit decayed too — +0.319 → +0.150. It merely decayed *less* than holding to
close, which is now negative. The edge did not simply relocate; it shrank and what
remains sits earlier.

> **Methodological note.** An earlier version of this table compared an
> *un-benchmarked* hour-1 return against a *benchmarked* close, which inflated
> hour-1 to +0.462 and suggested it had improved. Corrected above. NIFTY hourly
> bars (`ticker='NIFTY50IDX'`) were ingested specifically to make both legs
> comparable.

### Verdict

**+0.150% at a 52.9% win rate is not tradeable.** The hour-1 exit price comes from
Yahoo bar closes carrying 0.08–0.37% mean error — comparable in magnitude to the
edge itself, so the number is not reliably distinguishable from zero.

The decay is **structural, not cyclical**: it survives volatility conditioning, and
its intraday fingerprint is textbook crowding. Waiting for volatility to return will
not bring it back.

## Recommended next steps

1. **Obtain intraday data** (broker API — Zerodha Kite historical, or a vendor).
   This is now the binding constraint on everything: it would validate achievable
   fills, allow the opening-range and first-30/60/90-minute tests from the original
   brief, and permit a time-based or volatility-based exit instead of holding to
   close.
2. **Paper-trade the liquid tranche** using the current rules — gap ≥3%, turnover
   ≥₹100cr, volume <4×, short at open, cover at close, max 2 positions. Compare
   realised fills against the assumed open price. This directly measures the one
   unvalidated assumption, and needs no new data.
3. **Test the volume-filter × stress-month interaction** to confirm the ≥4×
   exclusion removes the April-2026 failure mode.
4. **Re-check the decay** — split 2024–26 further. If the edge is still shrinking,
   the planning number should be lower than +0.36%.

## Method notes

- Entry: opening price. Exit: same-day close. Both legs measured open-to-close.
- Excess vs NIFTY 50 over identical hours, so the index's own intraday drift is
  netted out; results are additionally reported against the no-signal short baseline.
- Costs: 0.20% round-trip assumed for intraday (STT applies to the sell side only at
  a reduced rate vs delivery); 0.40% reported as sensitivity.
- Liquidity: ₹5 Cr 20-day turnover floor throughout; tranches reported separately.
- Circuit-locked days (`high <= low × 1.001`) excluded from the yearly and monthly
  analyses.
- Split-adjusted prices throughout.
