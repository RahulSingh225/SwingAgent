# Coding Agent Instructions — IV Surface + RL Entry/Exit Discovery

**Repo:** SwingAgent  
**Audience:** Coding agent (Claude / Cursor / local agent)  
**Owner goal:** Discover and formalize the entry & exit conditions that drove Arpan Sengupta’s profitable option buying, then encode them as both a rule-based filter and learnable RL policies.

---

## 0. Context (read first)

We already have:

- Day-wise equity bhavcopy + adjusted prices
- India VIX (or ability to backfill)
- Event outcomes ledger, gap-fade / wave-fade research
- Arpan’s verified P&L (Excel in `resources/`) + trade-level FO/Equity/Commodity data
- Prior hypothesis work: VIX + Expansion Day filter, multi-day hold preference, premium ceiling, size discipline

**Core insight from research so far:**
Quiet days (low range / low gap) = pure theta bleed for long options.  
Expansion days + elevated/rising VIX = the environment where cheap OTM directional buys have edge.

This document tells you **exactly what to build**, in priority order, with the decision tree and constraints that must be respected.

---

## 1. Priority 1 — IV Surface Construction

### Goal
Build a usable Implied Volatility surface (or at least a reliable ATM / near-OTM IV time series) so every later model can condition on *how expensive options actually were* on the day Arpan entered.

### Required outputs
1. **Daily IV metrics table** (one row per trading day, per underlier of interest — start with NIFTY, BANKNIFTY, then liquid single stocks Arpan traded):
   - `date`
   - `underlier`
   - `spot`
   - `atm_iv` (or nearest strike IV)
   - `iv_rank_20d`, `iv_rank_60d`
   - `iv_percentile`
   - `front_expiry`, `next_expiry`
   - `term_structure_slope` (front – next, or 7d–30d equivalent)
   - `skew` (25Δ put IV – 25Δ call IV, or closest available)
   - `vix` (India VIX close) and `vix_change_1d`, `vix_ma_5`, `vix_ma_20`

2. **Option-level join table** that can be matched to Arpan’s trades:
   - For each of Arpan’s option trades, resolve: strike, expiry, side (CE/PE), buy avg, sell avg, days held, premium paid, and the IV environment *on entry day*.

### Data sources & implementation notes
- Prefer FO bhavcopy / NSE option data already partially handled by `scripts/fetch-fo-bhavcopy.py` and related scripts.
- If full chain history is incomplete, bootstrap with:
  - India VIX as market-wide IV proxy
  - Any available strike-level closes you can reconstruct from existing FO files
  - Black-Scholes inversion only where you have reliable price + time-to-expiry + rate assumptions (document assumptions clearly)
- Store results in Postgres (new tables, e.g. `iv_surface_daily`, `trade_iv_context`) so RL environments and research scripts can query them.
- Script location suggestion: `apps/web/scripts/build-iv-surface.ts` (or `.py` if you stay in the FO pipeline style).

### Acceptance criteria
- [ ] Daily ATM (or proxy) IV series for NIFTY covering the full Arpan trade window
- [ ] Every Arpan FO option trade can be joined to entry-day IV metrics
- [ ] Basic diagnostics printed: coverage %, missing days, correlation of ATM IV vs India VIX

---

## 2. Priority 2 — Reinforcement Learning Agents for Entry & Exit

### Goal
Use our market dataset + Arpan’s actual trades to *discover* (or at least approximate) the conditions under which he entered and exited, and to test whether those conditions generalize.

We are **not** trying to beat the market with black-box RL on day one.  
We are trying to answer:

> “Given the state of the world (OHLC, VIX, IV, expansion, OI if available), what policy would have reproduced Arpan’s profitable behavior, and can we improve the exit side?”

### Agents to build

| Agent | Responsibility | Notes |
|-------|----------------|-------|
| **Entry Agent** | Decide: enter / skip / small-size on a given day | Must respect expansion + VIX gate |
| **Exit Agent** | Decide: hold / exit / partial | Multi-day holds allowed; no forced EOD exit |
| **Sizing Agent** (optional v1.5) | Position size relative to capital / risk | Penalize size escalation after losses |
| **Full Policy Agent** | Joint entry + exit | Train only after separate agents are stable |

### Environment design (Gymnasium-style)

**State (minimum viable):**
- Nifty (or underlier) features: open, high, low, close, range %, gap %, prior 1d/3d/5d return, ATR or realized vol
- India VIX: level, 1d change, vs 5d MA, vs 20d MA
- IV surface features (from Priority 1): ATM IV, IV rank, skew, term slope
- Calendar: days to weekly/monthly expiry, day-of-week
- Portfolio state: currently in a position? days held, unrealized P&L, entry premium
- (Later) OI / volume expansion if data allows

**Actions:**
- Entry agent: `{skip, enter_long_call, enter_long_put, enter_small}`  
  (or continuous size in a later version)
- Exit agent: `{hold, exit_full, exit_half}` while in position

**Reward ideas (test several):**
1. Realized P&L of the trade (primary)
2. Risk-adjusted: P&L − λ × max drawdown of trade
3. Behavioral: bonus for matching Arpan’s actual entry days / direction (imitation + RL hybrid)
4. Explicit penalty for entering on quiet days (range < 0.8% and gap < 0.6%)
5. Explicit penalty for buying expensive premium (above a ceiling derived from Arpan’s distribution)

**Episode design:**
- One trading day = one step for entry decisions
- Once in a trade, subsequent days are exit-agent steps until exit or forced max-hold (e.g. 10 sessions)
- Use train / test temporal split (e.g. train on earlier years, test on 2025–2026) — never random shuffle of days

### Libraries & location
- Prefer Python for RL: `gymnasium`, `stable-baselines3` or `cleanrl`, `pandas`, `numpy`
- Put code under something like:
  ```
  apps/web/scripts/rl/
    env.py
    features.py
    train_entry.py
    train_exit.py
    evaluate.py
    configs/
  ```
- Or a new package `packages/rl/` if it grows.

### Acceptance criteria
- [ ] Environment can replay the historical day sequence with correct features
- [ ] Entry agent can be trained and produces a policy whose “enter” days can be compared to Arpan’s actual entry days
- [ ] Exit agent can be trained on the subset of days where a position was open
- [ ] Clear report: win rate, average hold days, average P&L, max drawdown vs Arpan baseline and vs the pure decision-tree rule set

---

## 3. Baseline Decision Tree (must be implemented first as a rule engine)

Before any neural net, implement this **exactly** as a deterministic filter. It becomes both a baseline and a hard constraint / feature inside the RL environment.

```
Is Nifty showing expansion today?
   (Range ≥ 0.8%  OR  Gap ≥ 0.6%)
        │
       Yes ──► Is India VIX rising  OR  above its recent average?
                    │
                   Yes ──► Eligible for cheap OTM option entry
                    │
                   No  ──► Smaller size or skip
        │
       No  ──► Stand down (quiet day = Theta risk)
```

### Implementation requirements
- `Range %` = (High − Low) / Previous Close × 100  (or / Open — document which and stay consistent)
- `Gap %` = (Open − Previous Close) / Previous Close × 100  (absolute value for “gap size”)
- “VIX rising” = VIX close > VIX close 1 session ago  **or** VIX close > 5-day MA (test both; report both)
- “Cheap OTM” = premium below a ceiling derived from Arpan’s actual entry premiums (compute the distribution; start with a conservative percentile, e.g. ≤ 75th or a hard ₹ cap if that matches his behavior)
- Output of the rule engine on every historical day: `eligible | small | skip` + reason code

This rule engine must be callable from both research scripts and the RL environment (as a mask or as a feature).

---

## 4. Additional Rules & Constraints (from prior research — do not ignore)

Encode these as soft or hard constraints:

1. **Premium ceiling** — Prefer the cheap end of the option chain. Expensive premium was rarely Arpan’s edge.
2. **Multi-day hold is allowed and preferred** — Do not force same-day exit. Exit agent owns the hold decision.
3. **Quiet day = stand down** — Already in the tree. Theta is the enemy on low-range days.
4. **Size discipline** — Penalize increasing size after a losing trade / losing day. Arpan’s edge includes not digging a hole with size.
5. **Directional leg** — Entry should eventually condition on a simple directional signal (prior day return, short-term momentum, or OI change if available). Pure non-directional long premium is weaker.
6. **Liquidity** — Only consider underliers / strikes that were realistically tradeable (use turnover / volume floors consistent with earlier gap-fade work).
7. **No look-ahead** — All features on day T must be knowable before or at the open of day T (or at the decision time you define). Document the decision timestamp assumption clearly.

---

## 5. Suggested Implementation Phases

### Phase A — Foundations (do first)
1. Confirm / backfill India VIX daily series into the DB.
2. Implement the **decision tree rule engine** and run it over the full history → produce a daily eligibility table.
3. Join Arpan’s option trades to market state + eligibility flags. Answer: “On what fraction of his actual entry days was the tree green?”

### Phase B — IV Surface
1. Build daily IV metrics (Priority 1).
2. Attach IV context to every Arpan trade.
3. Simple analysis: did he enter more often when IV rank was low / rising / high?

### Phase C — RL Environment + Exit Agent
1. Build Gymnasium env with the state features above.
2. Train **Exit Agent** first (cleaner credit assignment: once in a trade, only exit matters).
3. Evaluate hold-time distribution vs Arpan.

### Phase D — Entry Agent + Hybrid
1. Train Entry Agent, optionally with imitation reward toward Arpan’s entry days.
2. Combine with decision-tree mask (agent may only act when tree says eligible/small).
3. Full policy optional.

### Phase E — Reporting
- Side-by-side: Rule-only vs RL-entry vs RL-exit vs Arpan actual
- Out-of-sample stability
- Failure modes (which regimes destroy the edge)

---

## 6. Data Assets Already in Repo (use them)

| Asset | Location / notes |
|-------|------------------|
| Arpan verified P&L Excel | `resources/Arpan Sengupta (Blu_Dragon) – Verified P&L Trades.xlsx` |
| Arpan analysis doc | `docs/arpan-trade-analysis.md` |
| Gap-fade findings | `docs/gap-fade-findings.md` |
| Wave-fade findings | `docs/wave-fade-findings.md` |
| Outcome ledger | `docs/outcome-ledger.md`, `scripts/build-event-outcomes.ts` |
| Bhavcopy / prices | Ingestion + `eod_prices` / adjusted price scripts |
| FO bhavcopy fetcher | `scripts/fetch-fo-bhavcopy.py` |
| DB schema | `apps/web/lib/db/schema.ts` |

Extend schema rather than creating parallel CSV silos when possible.

---

## 7. What “Done” Looks Like

You can stop and report when you can answer, with evidence:

1. On which market regimes (expansion × VIX × IV rank) did Arpan actually enter?
2. Does the simple decision tree already capture a large fraction of his profitable entries?
3. Can an Exit RL agent improve average hold / exit timing over a fixed multi-day rule?
4. Does adding IV-surface features improve entry quality beyond VIX + range/gap alone?

Deliverables expected:
- Working rule-engine script + daily eligibility table
- IV surface tables + join to Arpan trades
- At least one trained Exit agent + one Entry agent with evaluation report
- Short markdown findings doc under `docs/` (e.g. `docs/rl-entry-exit-findings.md`)

---

## 8. Non-Goals (do not expand scope)

- Live broker auto-trading
- Full multi-underlier portfolio optimization
- High-frequency / intrabar RL (we do not have reliable full history of intraday option chains for that yet)
- Claiming a production edge before out-of-sample and cost-adjusted results are honest

---

## 9. Coding conventions

- Prefer TypeScript for anything that already lives in the Next/Drizzle world; Python is fine (and preferred) for pure RL + heavy numerical work.
- Every research script should be runnable from `apps/web` with clear CLI args and a summary printed to stdout.
- No look-ahead. No silent drops of NaNs without logging coverage.
- When you invent a constant (0.8% range, 0.6% gap, premium ceiling), put it in a single config object and log it in the report.

---

**Start with Phase A (decision tree + join to Arpan trades).**  
That single analysis will tell us whether the rest of the RL stack is even pointed at the right phenomenon.
