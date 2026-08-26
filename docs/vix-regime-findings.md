# VIX Regime Detection — measured, not assumed

**Built:** `scripts/build-regime-daily.py` -> table `regime_daily`
**Sample:** 1,688 NIFTY sessions, 2019-10-01 to 2026-08-03. IV-surface columns cover
246 of them (2025-08 onward), VRP 226.

Feature engineering and contingency tables only. No policy, no model, no RL.

## Column naming encodes when a value is knowable

The decision tree reads like a morning decision -- *"is Nifty showing expansion
today? (Range >= 0.8%)"* -- but range needs the session's high and low. It is not
knowable at the open, so an entry conditioned on it happens at the NEXT open at the
earliest. That is precisely the look-ahead the instructions' rule 7 forbids, and it
is easy to miss. Columns are therefore prefixed:

    open_*   knowable at today's open    -> safe for a same-day open entry
    (bare)   knowable at today's close   -> safe for next-open or later
    fwd_*    OUTCOMES. Never features.

## 1. Direction regime — the split matters, and the pooled number lies

| cell | n | E abs 1d | E abs 5d | VIX chg 5d |
|---|---|---|---|---|
| expansion + VIX rising | 149 | 1.385 | **2.934** | **+0.33** |
| expansion + VIX falling | 140 | 1.068 | 2.267 | −1.21 |
| expansion + VIX > MA5 | 148 | 1.297 | 2.964 | +0.44 |
| expansion + VIX < MA5 | 142 | 1.158 | 2.218 | −1.32 |
| all expansion | 291 | 1.226 | 2.596 | −0.42 |
| baseline | 1688 | 0.736 | 1.721 | −0.02 |

VIX rising wins on **both** legs: larger subsequent moves (2.93 vs 2.27) and vega
moving with you (+0.33 vs −1.21). "Require VIX rising" is a correct prior for a
multi-day long-vega hold.

The pooled `all expansion` row shows VIX chg −0.42, which is the average of +0.33
and −1.21 and describes neither. An earlier note used that pooled figure to argue
the VIX condition was backwards. It was not; the split reverses the conclusion.

## 2. Level regime — fixed bands BEAT percentile for forecasting move size

| bands | calm | low | normal | elevated | high | crisis | monotonic? |
|---|---|---|---|---|---|---|---|
| **fixed** (<12 … >30) | 1.15 | 1.39 | 1.61 | 2.10 | 3.38 | **4.68** | **yes** |
| **percentile** (of trailing 252d) | 1.19 | 1.58 | 1.85 | 1.67 | 1.48 | 2.52 | **no** |

(cells are mean forward absolute 5-day NIFTY move, %)

Fixed bands are cleanly monotonic across a 4x spread. Percentile bands are
non-monotonic -- `high` (1.48) forecasts *smaller* moves than `normal` (1.85).

The reason is mechanical: absolute VIX maps to absolute move size. VIX 30 means big
moves whether or not 30 is high relative to the last year. A percentile normalises
away exactly the information being forecast.

**But the coverage objection to fixed bands is also real.** In 2025-26 fixed bands
fire elevated-or-above on **6%** of sessions; percentile bands fire on **45%**.

So they are not competing, they answer different questions:

- **magnitude forecast** ("how big is the move") -> **fixed bands**
- **relative value** ("is premium rich versus recent history") -> **percentile**

Both are stored (`regime_level_fixed`, `regime_level_pct`). Use fixed for sizing the
expected move; use percentile for deciding which side of premium to be on.

## 3. Variance risk premium — the most decision-relevant column here

VRP = ATM IV (from the surface) minus realized vol. `vrp_hist` uses trailing RV20
and is a legitimate feature; `fwd_vrp` uses forward RV20 and is strictly an outcome.

    vrp_hist  (feature) mean +1.08  median +0.94  positive 65% of days
    fwd_vrp   (outcome) mean +0.79  median +1.43  positive 66% of days

`fwd_vrp` is what a premium seller actually earned. It is positive two days in three
— the classic variance risk premium, and consistent with the R1 result that buying
options loses at every level.

**Today's VRP predicts next month's, monotonically:**

| vrp_hist quartile | n | mean fwd_vrp |
|---|---|---|
| Q1 cheap | 57 | **−1.25** |
| Q2 | 56 | +0.17 |
| Q3 | 56 | +1.14 |
| Q4 rich | 57 | **+3.10** |

Selling into already-rich premium earned 3.1 vol points; selling into cheap premium
lost 1.25. This is the cleanest "which side to be on" signal produced so far.

### Two reasons not to act on it yet

**The sample is far thinner than n=226 suggests.** Forward windows are 20 sessions
and overlap, leaving roughly **11 independent observations** — about 3 per quartile.
The monotonicity is encouraging; it is not established.

**The distribution is left-skewed, and it is the same tail as before:**

    min -14.63   p05 -7.63   p25 -1.06   median +1.43   p75 +2.93   p95 +7.94   max +19.30

Mean (+0.79) sits below median (+1.43). The seller collects a small premium most
months and occasionally hands back 7-15 vol points. That is the same shape as the
R1 tail, where the worst session cost a sub-Rs5 seller 34x the premium collected,
measured over a year containing no crash.

## What this does and does not license

Licensed: using these columns as conditioning variables in contingency tables and
as features in a rule engine, with the naming convention respected.

Not licensed: sizing anything by the VRP mean, or treating the Q4 cell as an edge.
Eleven independent observations and a left tail is not a strategy.
