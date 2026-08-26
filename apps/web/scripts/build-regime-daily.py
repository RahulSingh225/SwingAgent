#!/usr/bin/env python3
"""
Daily volatility-regime features (docs/rl-reward-shaping.md sec.6, plus VRP).

WHAT THIS IS FOR
Feature engineering and contingency tables -- the "rule engine as hypothesis" step.
No policy, no model, no RL. One row per session, everything needed to ask whether a
regime split actually predicts anything.

TWO REGIMES, KEPT SEPARATE
  level     -- is vol high or low? (climate: which side of premium to be on)
  direction -- is vol rising or falling? (timing for anything long vega)
Collapsing them is why the pooled "VIX falls after gaps" statistic was misleading:
split by direction, expansion+VIX-rising shows VIX CONTINUING up (+0.34 over 5
sessions) while expansion+VIX-falling shows -1.21. The average of those two says
nothing about either.

LEVEL IS COMPUTED TWICE, ON PURPOSE
`regime_level_fixed` uses the conventional bands (<12 calm ... >30 crisis).
`regime_level_pct` uses a trailing percentile of VIX against itself.
The fixed bands are miscalibrated for the current market: over 2025-26 India VIX has
a median of 13.5 and 67% of sessions sit below 15, so fixed bands file almost
everything as "calm" and the elevated/high/crisis buckets never fire. The percentile
version keeps discriminating as the structural level of vol drifts. Both are stored
so the choice stays visible rather than baked in.

*** LOOK-AHEAD: READ BEFORE USING ANY COLUMN AS A FEATURE ***
The decision tree asks "is Nifty showing expansion today? (Range >= 0.8%)". Range
needs the session's high and low, so it is NOT knowable at the open -- an entry
conditioned on it can only happen at the NEXT open at the earliest. This is exactly
the trap the instructions' rule 7 forbids, and it is easy to miss because the tree
reads like a morning decision.

Columns are therefore prefixed by when they become knowable:
    open_*  knowable at today's open      -> safe for a same-day open entry
    (bare)  knowable at today's close     -> safe only for next-open or later
    fwd_*   OUTCOMES. Never features. Targets for contingency tables only.

Usage:
  DATABASE_URL=... python3 scripts/build-regime-daily.py [--report]
"""

import os, sys, argparse
import numpy as np
import pandas as pd
import psycopg2, psycopg2.extras

RANGE_TH = 0.8      # %, decision-tree threshold
GAP_TH   = 0.6      # %
RV_WIN   = 20       # sessions for realized vol
ANN      = np.sqrt(252)


def ensure_schema(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS regime_daily (
            date                date NOT NULL,
            underlier           text NOT NULL,
            close               double precision,
            open_gap_pct        double precision,
            open_expansion      boolean,
            range_pct           double precision,
            expansion_or        boolean,
            expansion_and       boolean,
            vix_close           double precision,
            vix_prev            double precision,
            vix_ma5             double precision,
            vix_ma20            double precision,
            vix_delta_5d        double precision,
            vix_up_streak       integer,
            vix_rank_20d        double precision,
            vix_rank_60d        double precision,
            vix_pctile_252      double precision,
            regime_level_fixed  text,
            regime_level_pct    text,
            regime_dir          text,
            atm_iv              double precision,
            iv_rank_20d         double precision,
            skew_25d            double precision,
            term_slope          double precision,
            rv20_hist           double precision,
            vrp_hist            double precision,
            fwd_rv20            double precision,
            fwd_vrp             double precision,
            fwd_abs_1           double precision,
            fwd_abs_5           double precision,
            fwd_ret_5           double precision,
            fwd_vix_chg_5       double precision,
            PRIMARY KEY (date, underlier)
        )""")
    cur.execute("CREATE INDEX IF NOT EXISTS regime_daily_idx ON regime_daily (underlier, date)")


def level_fixed(v):
    if v is None or np.isnan(v): return None
    if v < 12:  return 'calm'
    if v < 15:  return 'low'
    if v < 20:  return 'normal'
    if v < 25:  return 'elevated'
    if v < 30:  return 'high'
    return 'crisis'


def level_pct(p):
    """Percentile of VIX against its own trailing year."""
    if p is None or np.isnan(p): return None
    if p < 20:  return 'calm'
    if p < 40:  return 'low'
    if p < 60:  return 'normal'
    if p < 80:  return 'elevated'
    if p < 95:  return 'high'
    return 'crisis'


def up_streak(s):
    """Consecutive up closes ending at each point (0 when today is not an up close)."""
    out, run = [], 0
    prev = None
    for v in s:
        if prev is not None and v > prev: run += 1
        else: run = 0
        out.append(run); prev = v
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--underlier', default='NIFTY')
    ap.add_argument('--report', action='store_true', help='print the contingency tables')
    a = ap.parse_args()

    url = os.environ.get('DATABASE_URL')
    if not url: sys.exit('DATABASE_URL must be set')
    conn = psycopg2.connect(url); conn.autocommit = False
    cur = conn.cursor(); ensure_schema(cur); conn.commit()

    q = "SELECT date, open, high, low, close FROM index_prices WHERE index_name=%s ORDER BY date"
    n = pd.read_sql(q, conn, params=('NIFTY 50',))
    v = pd.read_sql(q, conn, params=('INDIA VIX',))
    n['date'] = pd.to_datetime(n.date); v['date'] = pd.to_datetime(v.date)
    d = n.merge(v[['date', 'close']].rename(columns={'close': 'vix'}), on='date').sort_values('date')
    d = d.reset_index(drop=True)

    prev = d.close.shift(1)
    d['open_gap_pct'] = 100 * (d.open / prev - 1)
    d['range_pct'] = 100 * (d.high - d.low) / prev
    d['open_expansion'] = d.open_gap_pct.abs() >= GAP_TH
    d['expansion_or'] = (d.range_pct >= RANGE_TH) | (d.open_gap_pct.abs() >= GAP_TH)
    d['expansion_and'] = (d.range_pct >= RANGE_TH) & (d.open_gap_pct.abs() >= GAP_TH)

    d['vix_prev'] = d.vix.shift(1)
    d['vix_ma5'] = d.vix.rolling(5).mean()
    d['vix_ma20'] = d.vix.rolling(20).mean()
    d['vix_delta_5d'] = d.vix - d.vix.shift(5)
    d['vix_up_streak'] = up_streak(d.vix.values)
    for w, col in ((20, 'vix_rank_20d'), (60, 'vix_rank_60d')):
        lo = d.vix.rolling(w).min(); hi = d.vix.rolling(w).max()
        d[col] = 100 * (d.vix - lo) / (hi - lo).replace(0, np.nan)
    d['vix_pctile_252'] = d.vix.rolling(252).apply(
        lambda x: 100.0 * (x[-1] >= x[:-1]).mean() if len(x) > 1 else np.nan, raw=True)

    d['regime_level_fixed'] = [level_fixed(x) for x in d.vix]
    d['regime_level_pct'] = [level_pct(x) for x in d.vix_pctile_252]
    d['regime_dir'] = np.where(d.vix > d.vix_prev, 'rising',
                        np.where(d.vix < d.vix_prev, 'falling', 'flat'))

    # Realized vol, close-to-close, annualised. Trailing is a feature; forward is an outcome.
    lr = np.log(d.close / d.close.shift(1))
    d['rv20_hist'] = lr.rolling(RV_WIN).std() * ANN * 100
    # Forward RV over the NEXT RV_WIN sessions, computed explicitly. Reversed-rolling
    # tricks realign on the index and silently shift by one; at 1.7k rows the loop is free.
    _lr = lr.values
    _fwd = np.full(len(_lr), np.nan)
    for i in range(len(_lr) - RV_WIN):
        _fwd[i] = np.std(_lr[i + 1:i + 1 + RV_WIN], ddof=1)
    d['fwd_rv20'] = _fwd * ANN * 100

    iv = pd.read_sql("""SELECT date, atm_iv*100 AS atm_iv, iv_rank_20d*100 AS iv_rank_20d,
                               skew_25d*100 AS skew_25d, term_slope*100 AS term_slope
                        FROM iv_surface_daily WHERE underlier=%s ORDER BY date""",
                     conn, params=(a.underlier,))
    iv['date'] = pd.to_datetime(iv.date)
    d = d.merge(iv, on='date', how='left')

    # Variance risk premium: implied minus realized. vrp_hist is what you can condition
    # on; fwd_vrp is what a seller actually earned and is strictly an outcome.
    d['vrp_hist'] = d.atm_iv - d.rv20_hist
    d['fwd_vrp'] = d.atm_iv - d.fwd_rv20

    d['fwd_abs_1'] = (100 * (d.close.shift(-1) / d.close - 1)).abs()
    d['fwd_abs_5'] = (100 * (d.close.shift(-5) / d.close - 1)).abs()
    d['fwd_ret_5'] = 100 * (d.close.shift(-5) / d.close - 1)
    d['fwd_vix_chg_5'] = d.vix.shift(-5) - d.vix

    cols = ['date', 'close', 'open_gap_pct', 'open_expansion', 'range_pct', 'expansion_or',
            'expansion_and', 'vix', 'vix_prev', 'vix_ma5', 'vix_ma20', 'vix_delta_5d',
            'vix_up_streak', 'vix_rank_20d', 'vix_rank_60d', 'vix_pctile_252',
            'regime_level_fixed', 'regime_level_pct', 'regime_dir', 'atm_iv', 'iv_rank_20d',
            'skew_25d', 'term_slope', 'rv20_hist', 'vrp_hist', 'fwd_rv20', 'fwd_vrp',
            'fwd_abs_1', 'fwd_abs_5', 'fwd_ret_5', 'fwd_vix_chg_5']
    out = d.dropna(subset=['range_pct']).copy()

    def clean(x):
        if x is None: return None
        if isinstance(x, (np.bool_, bool)): return bool(x)
        if isinstance(x, float) and np.isnan(x): return None
        if isinstance(x, (np.integer,)): return int(x)
        if isinstance(x, (np.floating,)): return float(x)
        return x

    rows = [tuple([r.date.date(), a.underlier] + [clean(getattr(r, c)) for c in cols[1:]])
            for r in out.itertuples()]
    cur.execute("DELETE FROM regime_daily WHERE underlier=%s", (a.underlier,))
    psycopg2.extras.execute_values(cur, f"""
        INSERT INTO regime_daily (date, underlier, close, open_gap_pct, open_expansion, range_pct,
            expansion_or, expansion_and, vix_close, vix_prev, vix_ma5, vix_ma20, vix_delta_5d,
            vix_up_streak, vix_rank_20d, vix_rank_60d, vix_pctile_252, regime_level_fixed,
            regime_level_pct, regime_dir, atm_iv, iv_rank_20d, skew_25d, term_slope,
            rv20_hist, vrp_hist, fwd_rv20, fwd_vrp, fwd_abs_1, fwd_abs_5, fwd_ret_5, fwd_vix_chg_5)
        VALUES %s ON CONFLICT DO NOTHING""", rows, page_size=1000)
    conn.commit()
    print(f'[regime] {len(rows)} sessions written for {a.underlier} '
          f'({out.date.min().date()} -> {out.date.max().date()})')
    print(f'[regime] IV surface coverage: {out.atm_iv.notna().sum()} sessions; '
          f'VRP(hist) available on {out.vrp_hist.notna().sum()}')

    if a.report:
        report(out)
    cur.close(); conn.close()


def report(d):
    print('\n' + '=' * 74)
    print('CONTINGENCY TABLES  (fwd_* are outcomes, never features)')
    print('=' * 74)
    e = d[d.expansion_and == True]
    print(f'\nexpansion(AND) = {len(e)} of {len(d)} sessions\n')
    print(f"{'cell':<36}{'n':>5}{'E|1d|':>8}{'E|5d|':>8}{'VIXchg5':>9}")
    for lab, m in [('expansion + VIX rising', e[e.regime_dir == 'rising']),
                   ('expansion + VIX falling', e[e.regime_dir == 'falling']),
                   ('expansion + VIX > MA5', e[e.vix > e.vix_ma5]),
                   ('expansion + VIX < MA5', e[e.vix <= e.vix_ma5]),
                   ('all expansion', e), ('baseline', d)]:
        if len(m) < 3: continue
        print(f"{lab:<36}{len(m):>5}{m.fwd_abs_1.mean():>8.3f}"
              f"{m.fwd_abs_5.mean():>8.3f}{m.fwd_vix_chg_5.mean():>9.2f}")

    print('\n--- level regime: fixed bands vs percentile ---')
    for col in ('regime_level_fixed', 'regime_level_pct'):
        g = d.groupby(col, observed=True).agg(n=('close', 'size'), abs5=('fwd_abs_5', 'mean'),
                                              vixchg=('fwd_vix_chg_5', 'mean')).round(2)
        print(f'\n{col}:'); print(g.to_string())

    v = d.dropna(subset=['vrp_hist', 'fwd_vrp'])
    if len(v) > 20:
        print('\n--- variance risk premium (ATM IV minus realized vol, points) ---')
        print(f'  vrp_hist  (feature, trailing RV20): mean {v.vrp_hist.mean():+.2f}  '
              f'median {v.vrp_hist.median():+.2f}  positive {100*(v.vrp_hist>0).mean():.0f}% of days')
        print(f'  fwd_vrp   (OUTCOME, forward RV20) : mean {v.fwd_vrp.mean():+.2f}  '
              f'median {v.fwd_vrp.median():+.2f}  positive {100*(v.fwd_vrp>0).mean():.0f}% of days')
        print('  fwd_vrp is what a premium seller actually earned. Positive = selling paid.')
        q = pd.qcut(v.vrp_hist, 4, labels=['Q1 cheap', 'Q2', 'Q3', 'Q4 rich'])
        print('\n  does today\'s VRP predict the next month\'s VRP?')
        print(v.groupby(q, observed=True).agg(n=('fwd_vrp', 'size'),
              fwd_vrp=('fwd_vrp', 'mean')).round(2).to_string())


if __name__ == '__main__':
    main()
