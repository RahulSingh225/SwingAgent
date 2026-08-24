# Coding Agent Instructions — IV Surface, Rule Engine & Regime Analysis

**Repo:** SwingAgent  
**Audience:** Coding agent  
**Status:** Rewritten 2026-08-25 after contract-day analysis and agent review.

---

## 0. What changed and why

An earlier version of this document treated “formalize Arpan’s profitable *buying* of cheap options” as the goal and prescribed an RL stack (entry/exit agents, imitation rewards, premium ceiling as a hard constraint).

That premise is now contested:

- Large-sample contract-day tests on cheap NIFTY options showed deeply negative expected returns over 1–5 sessions.
- Book structure (many Buy Avg = 0 rows, high OTM-finish rate) is more consistent with *selling* premium than with systematically buying cheap long convexity.
- There are **no clean entry-day labels** (one row ≈ one symbol lifetime). Bhavcopy can only produce *candidate* sessions.
- Eligible days under a loose OR-gate are ~44% of history — not a real filter. An AND-gate is materially stronger in partial tests.
- ~700–1,600 daily episodes on a single realized path is a poor fit for RL; sequential credit assignment helps most on *exits*, where data is weakest.

**Therefore:**

| Item | Status |
|------|--------|
| **Priority 1 — IV surface** | **Build. Unconditionally.** |
| **Rule engine (decision tree)** | **Build as a hypothesis under test**, not as a hard constraint. Prefer AND; test VIX direction. |
| **Phase A — regime on Arpan candidates** | **Build.** Resolve fills → candidate sessions; measure regimes with evidence. |
| **RL entry/exit agents** | **Parked.** Do not implement until Phase A and IV surface exist and the buying premise is resolved. |
| **Premium ceiling as “prefer cheap”** | **Retired as a hard rule.** Re-evaluate only after DTE-controlled analysis. |

If a learned model is wanted later, prefer **gradient-boosted trees on a supervised target** over RL for this sample size and tabular state.

---

## 1. Priority 1 — IV Surface (do this first)

### Goal
Produce a usable implied-volatility surface (or at least reliable daily IV metrics) so every later analysis can condition on *how expensive options actually were*.

This does **not** depend on the disputed buying premise. It is the missing input for the rest of the project.

### Required outputs

1. **Daily IV metrics table** (start with NIFTY, then BANKNIFTY / liquid names as data allows):

   | Column | Meaning |
   |--------|--------|
   | `date`, `underlier` | |
   | `spot` | Underlying close |
   | `atm_iv` | ATM or nearest-strike IV |
   | `iv_rank_20d`, `iv_rank_60d` | |
   | `iv_percentile` | |
   | `front_expiry`, `next_expiry` | |
   | `term_structure_slope` | Front − next (or 7d–30d equiv.) |
   | `skew` | e.g. 25Δ put − 25Δ call, or closest available |
   | `vix`, `vix_change_1d`, `vix_ma_5`, `vix_ma_20` | India VIX context |

2. **Optional but valuable:** option-level context joinable to any future trade reconstruction (strike, expiry, IV on that day).

### Implementation notes

- Source: FO bhavcopy / per-strike closes already partially handled by `scripts/fetch-fo-bhavcopy.py` and related pipelines (~millions of rows with close + underlying → BS inversion is straightforward).
- Document rate, dividend, and day-count assumptions used in inversion.
- Store in Postgres (`iv_surface_daily`, etc.) so research scripts and the dashboard can query them.
- Suggested location: `apps/web/scripts/build-iv-surface.ts` or `.py` next to the FO pipeline.

### Acceptance criteria

- [ ] Daily ATM (or proxy) IV series for NIFTY covering the analysis window
- [ ] Coverage %, missing days, and correlation of ATM IV vs India VIX printed in a short report
- [ ] Tables queryable from the same DB the rest of the project uses

---

## 2. Rule engine — hypothesis under test (not a constraint)

Implement the expansion × VIX logic as a **deterministic, testable filter**. Do not hard-code it inside an RL mask yet.

### Baseline tree (revise from earlier OR-heavy version)

```
Is Nifty showing expansion today?
   Prefer AND for a real filter:
   (Range ≥ 0.8%  AND  |Gap| ≥ 0.6%)   # test; also report OR for comparison
        │
       Yes ──► VIX condition (TEST both directions; do not assume “rising is good”)
                    │
                   A: VIX rising OR above recent MA
                   B: VIX falling OR below recent MA
                    │
                   Report expansion × VIX cells separately
        │
       No  ──► Stand down (quiet day)
```

### Why AND and why test VIX direction

- Partial results: OR eligibility ~44% of days (weak); AND much tighter and showed stronger absolute-move multiples in tests.
- Gap-expansion days have been observed with VIX *falling* over subsequent sessions — so “VIX rising” may be the wrong long-vega prior. Measure both.

### Implementation requirements

- `Range %` and `Gap %` definitions documented and fixed in one config object.
- Output for every historical day: `eligible_and` / `eligible_or` / `skip` + reason codes + VIX bucket.
- Script must print contingency tables: expansion × VIX direction × forward realized move (1d / 5d) so the hypothesis is falsifiable.

### Acceptance criteria

- [ ] Daily eligibility table for the full history
- [ ] Side-by-side OR vs AND counts and forward-move multiples
- [ ] VIX-rising vs VIX-falling cells reported separately (no assumed sign)

---

## 3. Phase A — Arpan regime analysis (done properly)

### Goal
Answer with evidence: **in which market regimes did Arpan’s fills actually sit?**

### Method

1. From Arpan FO rows, take buy/sell averages and symbols.
2. Use bhavcopy (and FO chain data where available) to find **candidate sessions** where a fill at that price is feasible (e.g. session Low ≤ price ≤ High for that contract).
3. Expect a small set of candidate days per trade (often 2–3), not a unique timestamp.
4. On those candidate days, measure:
   - Expansion (range / gap)
   - India VIX level and change
   - IV rank / ATM IV (once Priority 1 exists)
   - DTE of the contract
   - Directional context (prior returns, etc.)
5. Aggregate: distribution of regimes on candidate sets vs base-rate of all days.

### What this is *not*

- Not supervised “entry day” labels for imitation learning.
- Not proof he was long or short — only evidence of *when* those prices were tradeable.

### Acceptance criteria

- [ ] Candidate-session resolution pipeline for a meaningful fraction of Arpan FO rows
- [ ] Regime stats (expansion × VIX × IV) on candidates vs unconditional base rates
- [ ] Short findings note under `docs/` (e.g. `docs/arpan-regime-candidates.md`)

---

## 4. Explicitly parked — RL stack

Do **not** implement in this pass:

- Entry / Exit / Sizing / Full-policy RL agents
- Gymnasium env driven by imitation of Arpan entry days
- Reward terms that require “Arpan entered same side that day” as a hard label
- Premium ceiling encoded as “prefer the cheap end” without DTE controls

**If** Phase A + IV surface later support a clear sequential decision problem (especially **exits**) and sample size improves, revisit with:

- Supervised GBT first (tabular, cross-validatable), or
- A small Exit-only RL experiment with honest train/test temporal splits and pure-P&L baselines.

Until then, RL is out of scope.

Related doc `docs/rl-reward-shaping.md` remains a **reference design only** — not an implementation order.

---

## 5. Suggested build order

| Step | Work | Depends on |
|------|------|------------|
| A | Confirm / backfill India VIX daily into DB | — |
| B | **IV surface** (Priority 1) | FO bhavcopy / chain closes |
| C | **Rule engine** (AND + OR, both VIX directions, forward-move tables) | OHLC + VIX |
| D | **Phase A** candidate sessions + regime stats | Arpan FO + bhavcopy + (B) for IV |
| E | Findings markdown | C + D |
| F | Only then: optional GBT or limited Exit experiment | Clear target from E |

---

## 6. Data assets (unchanged)

| Asset | Location / notes |
|-------|------------------|
| Arpan verified P&L Excel | `resources/` |
| Arpan analysis | `docs/arpan-trade-analysis.md` |
| Gap-fade / wave-fade / ledger | `docs/*-findings.md`, `docs/outcome-ledger.md` |
| FO bhavcopy fetcher | `scripts/fetch-fo-bhavcopy.py` |
| Schema | `apps/web/lib/db/schema.ts` |
| Prior RL reward design (reference only) | `docs/rl-reward-shaping.md` |

---

## 7. Non-goals (this pass)

- Live broker automation
- RL training loops
- Hard-coding “buy cheap OTM on expansion + rising VIX” as production policy
- Claiming edge before cost-adjusted, out-of-sample, and regime-decay checks

---

## 8. Definition of done (this pass)

You can stop and report when:

1. IV surface (or daily ATM IV + rank + skew + term) is queryable for NIFTY over the study window.  
2. Rule engine has published OR vs AND and VIX-up vs VIX-down forward-move tables.  
3. Phase A has regime distributions on Arpan candidate sessions vs base rates.  
4. A short findings doc states clearly whether the old “long cheap convexity on expansion + rising VIX” story is supported, inverted, or inconclusive.

**Start with IV surface, then rule engine, then Phase A.**  
Do not start RL.
