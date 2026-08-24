# RL Reward Shaping — Entry & Exit Agents

**Location for implementation:** `apps/web/scripts/rl/reward.py` (or `packages/rl/reward.py`)  
**Companion instructions:** [coding-agent-instructions-iv-rl.md](coding-agent-instructions-iv-rl.md)

This document is the canonical reference for reward design. Copy the code block below into the RL package when you implement the environment.

---

## Design principles

1. **Primary signal stays economic** — final realized P&L (or risk-adjusted P&L) must dominate.
2. **Shape only what we already believe** — quiet-day penalty, premium ceiling, size discipline, expansion preference.
3. **No look-ahead** — every term uses only information available at decision time or the realized outcome at trade close.
4. **Always keep a pure-P&L baseline** — report unshaped results so shaping cannot invent a fake edge.

---

## Decision-tree thresholds (must stay consistent with the rule engine)

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

---

## Full reward module

```python
"""
reward.py — Reward shaping for SwingAgent RL (Entry + Exit)

Drop into: apps/web/scripts/rl/reward.py
(or packages/rl/reward.py)

All λ coefficients live in RewardConfig so ablations are one-line changes.
No look-ahead: every term uses only state available at decision time
or the realized outcome at trade close.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@dataclass
class RewardConfig:
    # Exit agent
    lambda_theta: float = 0.15      # daily penalty while holding on quiet day
    lambda_time: float = 0.05       # gentle pressure against overstaying
    lambda_forced: float = 0.50     # extra hit if max-hold exit is underwater
    max_hold_days: int = 10

    # Entry agent
    lambda_quiet: float = 0.80      # enter outside expansion → strong penalty
    lambda_vix: float = 0.60        # enter when VIX not supportive → penalty
    lambda_premium: float = 0.40    # scale free above ceiling
    lambda_match: float = 0.10      # optional imitation of Arpan (keep small)
    premium_ceiling: float = 300.0  # ₹; derive from Arpan distribution later

    # Decision-tree thresholds (must match the rule engine)
    range_threshold: float = 0.8    # %
    gap_threshold: float = 0.6      # %

    # Global
    cost_per_trade: float = 0.002   # 20 bps round-trip assumption (adjust)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_expansion(range_pct: float, gap_pct: float, cfg: RewardConfig) -> bool:
    return (range_pct >= cfg.range_threshold) or (abs(gap_pct) >= cfg.gap_threshold)


def is_vix_supportive(
    vix: float,
    vix_prev: float,
    vix_ma: float,
) -> bool:
    """Rising or above recent average."""
    return (vix > vix_prev) or (vix > vix_ma)


def is_quiet(range_pct: float, gap_pct: float, cfg: RewardConfig) -> bool:
    return not is_expansion(range_pct, gap_pct, cfg)


# ---------------------------------------------------------------------------
# Exit agent reward
# ---------------------------------------------------------------------------

def compute_exit_reward(
    *,
    unrealized_pnl_prev: float,
    unrealized_pnl_now: float,
    range_pct: float,
    gap_pct: float,
    days_held: int,
    action: Literal["hold", "exit_full", "exit_half"],
    realized_pnl_net: Optional[float] = None,  # only on full exit
    cfg: RewardConfig = RewardConfig(),
) -> float:
    """
    Called every step the Exit agent is active (i.e. a position is open).

    - Intermediate steps: mark-to-market Δ + shaping penalties.
    - On full exit: add terminal realized P&L (net of costs).
    """
    # 1. Mark-to-market change
    r = unrealized_pnl_now - unrealized_pnl_prev

    # 2. Quiet-day theta penalty (only while still holding)
    if action == "hold" and is_quiet(range_pct, gap_pct, cfg):
        r -= cfg.lambda_theta

    # 3. Time pressure (always, while position open)
    r -= cfg.lambda_time * (days_held / cfg.max_hold_days)

    # 4. Terminal terms on full exit
    if action == "exit_full" and realized_pnl_net is not None:
        r += realized_pnl_net
        # Forced max-hold exit while underwater
        if days_held >= cfg.max_hold_days and realized_pnl_net < 0:
            r -= cfg.lambda_forced

    # Half-exit: you may credit half the realized slice if you track it;
    # for v1 keep it simple and only terminal-reward on full exit.
    return r


# ---------------------------------------------------------------------------
# Entry agent reward
# ---------------------------------------------------------------------------

def compute_entry_reward(
    *,
    action: Literal["skip", "enter_long_call", "enter_long_put", "enter_small"],
    range_pct: float,
    gap_pct: float,
    vix: float,
    vix_prev: float,
    vix_ma: float,
    premium: Optional[float] = None,          # required if entering
    arpan_entered_same_side: bool = False,    # optional imitation flag
    realized_pnl_net: Optional[float] = None, # filled later when trade closes
    cfg: RewardConfig = RewardConfig(),
) -> float:
    """
    Called on every bar for the Entry agent.

    - skip → 0
    - enter → immediate shaping penalties/bonuses
    - when the resulting trade later closes, add realized_pnl_net
      (call this function again or use a separate terminal hook)
    """
    if action == "skip":
        return 0.0

    r = 0.0

    # 1. Decision-tree violations
    if is_quiet(range_pct, gap_pct, cfg):
        r -= cfg.lambda_quiet

    if not is_vix_supportive(vix, vix_prev, vix_ma):
        r -= cfg.lambda_vix

    # 2. Premium ceiling
    if premium is not None and premium > cfg.premium_ceiling:
        over = (premium - cfg.premium_ceiling) / cfg.premium_ceiling
        r -= cfg.lambda_premium * over

    # 3. Light imitation of Arpan (optional, keep λ small)
    if arpan_entered_same_side:
        r += cfg.lambda_match

    # 4. Terminal economic outcome (only when trade is closed)
    if realized_pnl_net is not None:
        r += realized_pnl_net

    return r


# ---------------------------------------------------------------------------
# Combined / terminal helper (useful inside env.step)
# ---------------------------------------------------------------------------

def apply_trade_close_reward(
    base_reward: float,
    realized_pnl_gross: float,
    cfg: RewardConfig = RewardConfig(),
) -> float:
    """Subtract assumed costs and return final terminal reward."""
    net = realized_pnl_gross - cfg.cost_per_trade * abs(realized_pnl_gross)
    # Alternative: fixed bps on notional — adjust to your accounting
    return base_reward + net


# ---------------------------------------------------------------------------
# Decision-tree mask (hard constraint for the Entry agent)
# ---------------------------------------------------------------------------

def entry_action_mask(
    range_pct: float,
    gap_pct: float,
    vix: float,
    vix_prev: float,
    vix_ma: float,
    cfg: RewardConfig = RewardConfig(),
) -> dict[str, bool]:
    """
    Returns which entry actions are legal.
    Use this to mask the action space so the agent cannot even choose
    illegal actions (stronger than pure reward penalty).
    """
    expansion = is_expansion(range_pct, gap_pct, cfg)
    vix_ok = is_vix_supportive(vix, vix_prev, vix_ma)

    if not expansion:
        return {
            "skip": True,
            "enter_long_call": False,
            "enter_long_put": False,
            "enter_small": False,
        }

    if not vix_ok:
        # Tree says "smaller size or skip"
        return {
            "skip": True,
            "enter_long_call": False,
            "enter_long_put": False,
            "enter_small": True,
        }

    return {
        "skip": True,
        "enter_long_call": True,
        "enter_long_put": True,
        "enter_small": True,
    }
```

---

## Wiring inside `env.step`

```python
def step(self, action):
    ...
    if self.position is not None:
        # Exit agent is in control
        reward = compute_exit_reward(
            unrealized_pnl_prev=self.prev_unrealized,
            unrealized_pnl_now=self.current_unrealized,
            range_pct=self.today.range_pct,
            gap_pct=self.today.gap_pct,
            days_held=self.days_held,
            action=action,  # "hold" | "exit_full" | "exit_half"
            realized_pnl_net=realized if action == "exit_full" else None,
            cfg=self.reward_cfg,
        )
    else:
        # Entry agent
        reward = compute_entry_reward(
            action=action,
            range_pct=self.today.range_pct,
            gap_pct=self.today.gap_pct,
            vix=self.today.vix,
            vix_prev=self.today.vix_prev,
            vix_ma=self.today.vix_ma_5,
            premium=chosen_premium if "enter" in action else None,
            arpan_entered_same_side=self.today.arpan_flag,
            realized_pnl_net=None,  # filled when trade later closes
            cfg=self.reward_cfg,
        )
    ...
    return obs, reward, terminated, truncated, info
```

---

## Ablation checklist

Always train and evaluate these variants:

1. Pure P&L only (all λ = 0 except terminal)
2. + quiet / VIX penalties
3. + premium ceiling
4. + time / theta
5. + imitation term

Report both **shaped** and **unshaped** metrics so you know the shaping is not creating a fake edge.

---

## Suggested starting coefficients

| Coefficient        | Default | Role                                      |
|--------------------|---------|-------------------------------------------|
| `lambda_quiet`     | 0.80    | Strongly discourage entries on quiet days |
| `lambda_vix`       | 0.60    | Prefer rising / elevated VIX              |
| `lambda_premium`   | 0.40    | Prefer cheap premium                      |
| `lambda_theta`     | 0.15    | Daily bleed while holding on quiet days   |
| `lambda_time`      | 0.05    | Gentle pressure not to overstay           |
| `lambda_forced`    | 0.50    | Extra cost of max-hold underwater exit    |
| `lambda_match`     | 0.10    | Light imitation of Arpan (keep small)     |
| `premium_ceiling`  | 300.0   | ₹ — refine from Arpan's actual distribution |
| `max_hold_days`    | 10      | Hard cap on holding period                |

Put every constant in `RewardConfig` and log the full config in every evaluation report.
