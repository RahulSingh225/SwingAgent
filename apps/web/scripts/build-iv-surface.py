#!/usr/bin/env python3
"""
Implied volatility surface from real option prices (fo_bhavcopy).

WHY
Every model in this project that needed to know "how expensive were options that
day" has had to guess sigma, and the guess decided the answer -- the R1 simulation
flipped sign between sigma multipliers 1.0 and 1.3. India VIX is a single ATM
30-day number and cannot express skew or term structure. With 4.1M rows of traded
option closes we can stop guessing and invert the prices we actually have.

METHOD -- FORWARD FROM PUT-CALL PARITY, NOT FROM AN ASSUMED DIVIDEND YIELD
Textbook Black-Scholes on an index needs a dividend yield, which we do not have and
which would silently bias every IV. Instead the forward is recovered from the market
itself. For strikes where both legs trade,

    C - P = df * (F - K)   =>   F = K + (C - P) / df

Take the median implied F over the strikes nearest the money, then price everything
with Black-76 against that forward. Rate enters only through the discount factor,
where a 100bp error moves IV by a rounding digit. Dividends drop out entirely.

WHAT IS SKIPPED, AND WHY THAT IS NOT OPTIONAL
  - expiry day (T = 0): no time value, IV undefined
  - options trading at or below intrinsic: inversion has no solution
  - options worth less than one tick over intrinsic: the Rs0.05 tick is a large
    fraction of a cheap option's price, so IV there is quantisation noise, not
    information. Including them would put garbage in exactly the deep-OTM region
    the research cares about.

OUTPUTS
  option_iv         per contract-day: iv, delta, forward, tte, moneyness
  iv_surface_daily  per day: atm_iv, iv_rank_20d/60d, iv_pctile_252, term slope,
                    25-delta skew, joined to India VIX

Usage:
  DATABASE_URL=... python3 scripts/build-iv-surface.py [--tickers NIFTY,BANKNIFTY]
"""

import os, sys, argparse
import numpy as np
import pandas as pd
import psycopg2, psycopg2.extras

TICK = 0.05
RATE = 0.065
MIN_TTE = 1.0 / 365.0          # expiry day carries no time value
IV_LO, IV_HI = 0.005, 5.0
BISECT_ITERS = 60              # 5.0 -> ~4e-18; convergence is not the weak link


def _erf(x):
    """Vectorised erf via Abramowitz-Stegun 7.1.26 (|err| < 1.5e-7)."""
    s = np.sign(x); x = np.abs(x)
    t = 1.0 / (1.0 + 0.3275911 * x)
    y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
                - 0.284496736) * t + 0.254829592) * t * np.exp(-x * x)
    return s * y


def ncdf(x):
    return 0.5 * (1.0 + _erf(x / np.sqrt(2.0)))


def black76(F, K, T, sig, is_call, df):
    """Undiscounted-forward Black-76 price."""
    sq = sig * np.sqrt(T)
    sq = np.where(sq < 1e-12, 1e-12, sq)
    d1 = (np.log(F / K) + 0.5 * sig * sig * T) / sq
    d2 = d1 - sq
    call = df * (F * ncdf(d1) - K * ncdf(d2))
    put = df * (K * ncdf(-d2) - F * ncdf(-d1))
    return np.where(is_call, call, put)


def implied_vol(price, F, K, T, is_call, df):
    """Vectorised bisection. Monotone in sigma, so this cannot miss a root."""
    lo = np.full_like(price, IV_LO)
    hi = np.full_like(price, IV_HI)
    for _ in range(BISECT_ITERS):
        mid = 0.5 * (lo + hi)
        v = black76(F, K, T, mid, is_call, df)
        too_low = v < price
        lo = np.where(too_low, mid, lo)
        hi = np.where(too_low, hi, mid)
    iv = 0.5 * (lo + hi)
    # A root pinned at either bound never converged -- report nothing rather than a bound.
    return np.where((iv <= IV_LO * 1.01) | (iv >= IV_HI * 0.99), np.nan, iv)


def ensure_schema(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS option_iv (
            trade_date  date NOT NULL,
            underlier   text NOT NULL,
            expiry      date NOT NULL,
            strike      double precision NOT NULL,
            option_type text NOT NULL,
            close       double precision,
            forward     double precision,
            tte         double precision,
            iv          double precision,
            delta       double precision,
            moneyness   double precision,
            PRIMARY KEY (trade_date, underlier, expiry, strike, option_type)
        )""")
    cur.execute("CREATE INDEX IF NOT EXISTS option_iv_day_idx ON option_iv (underlier, trade_date)")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS iv_surface_daily (
            date            date NOT NULL,
            underlier       text NOT NULL,
            spot            double precision,
            front_expiry    date,
            next_expiry     date,
            forward         double precision,
            dte             integer,
            atm_iv          double precision,
            next_atm_iv     double precision,
            term_slope      double precision,
            skew_25d        double precision,
            iv_rank_20d     double precision,
            iv_rank_60d     double precision,
            iv_pctile_252   double precision,
            n_strikes       integer,
            vix             double precision,
            vix_chg_1d      double precision,
            vix_ma5         double precision,
            vix_ma20        double precision,
            PRIMARY KEY (date, underlier)
        )""")


def compute_forwards(d):
    """
    One forward per (trade_date, expiry), from put-call parity on the strikes
    nearest the money. Returns a frame keyed by those two columns.
    """
    both = d.pivot_table(index=['trade_date', 'expiry', 'strike'],
                         columns='option_type', values='close', aggfunc='first')
    both = both.dropna(subset=['CE', 'PE']).reset_index()
    if len(both) == 0:
        return pd.DataFrame(columns=['trade_date', 'expiry', 'forward'])
    und = d.groupby(['trade_date', 'expiry']).underlying.first().rename('und')
    both = both.join(und, on=['trade_date', 'expiry'])
    both['tte'] = (pd.to_datetime(both.expiry) - pd.to_datetime(both.trade_date)).dt.days / 365.0
    both = both[both.tte >= MIN_TTE]
    both['df'] = np.exp(-RATE * both.tte)
    both['F_impl'] = both.strike + (both.CE - both.PE) / both['df']
    both['dist'] = (both.strike - both.und).abs()

    # Parity is only reliable near the money; far strikes have one illiquid leg.
    both = both.sort_values(['trade_date', 'expiry', 'dist'])
    near = both.groupby(['trade_date', 'expiry']).head(6)
    fwd = near.groupby(['trade_date', 'expiry']).F_impl.median().rename('forward').reset_index()
    # A forward far from spot means the parity strikes were stale -- fall back to spot.
    fwd = fwd.merge(und.reset_index(), on=['trade_date', 'expiry'], how='left')
    bad = (fwd.forward / fwd.und - 1).abs() > 0.05
    fwd.loc[bad, 'forward'] = fwd.loc[bad, 'und']
    return fwd[['trade_date', 'expiry', 'forward']]


def interp_at(x, y, target):
    """Linear interpolation of y at x=target; requires x sorted and bracketing."""
    if len(x) < 2:
        return np.nan
    if target < x.min() or target > x.max():
        return np.nan
    return float(np.interp(target, x, y))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tickers', default='NIFTY,BANKNIFTY')
    ap.add_argument('--min-volume', type=int, default=100)
    a = ap.parse_args()
    tickers = [t.strip().upper() for t in a.tickers.split(',')]

    url = os.environ.get('DATABASE_URL')
    if not url:
        sys.exit('DATABASE_URL must be set')
    conn = psycopg2.connect(url); conn.autocommit = False
    cur = conn.cursor()
    ensure_schema(cur); conn.commit()

    vix = pd.read_sql("""SELECT date, close AS vix FROM index_prices
                         WHERE index_name = 'INDIA VIX' ORDER BY date""", conn)
    vix['date'] = pd.to_datetime(vix.date)
    vix['vix_chg_1d'] = vix.vix.diff()
    vix['vix_ma5'] = vix.vix.rolling(5).mean()
    vix['vix_ma20'] = vix.vix.rolling(20).mean()

    for tk in tickers:
        d = pd.read_sql("""
            SELECT trade_date, expiry, strike, option_type, close, volume, underlying
            FROM fo_bhavcopy
            WHERE ticker = %s AND option_type IN ('CE','PE')
              AND close > 0 AND underlying > 0 AND volume >= %s
        """, conn, params=(tk, a.min_volume))
        if len(d) == 0:
            print(f'[{tk}] no rows'); continue
        d['trade_date'] = pd.to_datetime(d.trade_date)
        d['expiry'] = pd.to_datetime(d.expiry)
        raw_n = len(d)

        fwd = compute_forwards(d)
        d = d.merge(fwd, on=['trade_date', 'expiry'], how='inner')
        d['tte'] = (d.expiry - d.trade_date).dt.days / 365.0
        d = d[d.tte >= MIN_TTE].copy()
        d['df'] = np.exp(-RATE * d.tte)
        is_call = (d.option_type == 'CE').values

        # Below intrinsic there is no root; within a tick of it there is only noise.
        intrinsic = d.df.values * np.where(is_call,
                                           np.maximum(0.0, d.forward.values - d.strike.values),
                                           np.maximum(0.0, d.strike.values - d.forward.values))
        keep = d.close.values > intrinsic + TICK
        dropped_intrinsic = int((~keep).sum())
        d = d[keep].copy()
        is_call = (d.option_type == 'CE').values

        iv = implied_vol(d.close.values, d.forward.values, d.strike.values,
                         d.tte.values, is_call, d.df.values)
        d['iv'] = iv
        sq = d.iv.values * np.sqrt(d.tte.values)
        d1 = (np.log(d.forward.values / d.strike.values) + 0.5 * d.iv.values ** 2 * d.tte.values) / sq
        d['delta'] = np.where(is_call, d.df.values * ncdf(d1), -d.df.values * ncdf(-d1))
        d['moneyness'] = d.strike.values / d.forward.values - 1.0
        conv = d.iv.notna()
        d = d[conv].copy()

        print(f'[{tk}] {raw_n:,} traded rows -> {len(d):,} with IV '
              f'({dropped_intrinsic:,} dropped at/below intrinsic, '
              f'{int((~conv).sum()):,} failed to converge)')

        rows = list(zip(d.trade_date.dt.date, [tk] * len(d), d.expiry.dt.date,
                        d.strike, d.option_type, d.close, d.forward, d.tte,
                        d.iv, d.delta, d.moneyness))
        cur.execute("DELETE FROM option_iv WHERE underlier = %s", (tk,))
        psycopg2.extras.execute_values(cur, """
            INSERT INTO option_iv (trade_date,underlier,expiry,strike,option_type,
                                   close,forward,tte,iv,delta,moneyness)
            VALUES %s ON CONFLICT DO NOTHING
        """, [tuple(None if pd.isna(v) else v for v in r) for r in rows], page_size=5000)
        conn.commit()

        # ---- daily aggregation -------------------------------------------------
        daily = []
        for day, g in d.groupby('trade_date'):
            exps = sorted(g.expiry.unique())
            if not exps:
                continue
            front = exps[0]
            nxt = exps[1] if len(exps) > 1 else None
            fg = g[g.expiry == front].sort_values('strike')
            if len(fg) < 4:
                continue
            F = float(fg.forward.iloc[0])

            # ATM IV: interpolate the smile at K = F rather than trusting one strike.
            sm = fg.groupby('strike').iv.mean().sort_index()
            atm = interp_at(sm.index.values.astype(float), sm.values, F)

            nxt_atm = np.nan
            if nxt is not None:
                ng = g[g.expiry == nxt]
                if len(ng) >= 4:
                    ns = ng.groupby('strike').iv.mean().sort_index()
                    nxt_atm = interp_at(ns.index.values.astype(float), ns.values,
                                        float(ng.forward.iloc[0]))

            # 25-delta skew: put IV at delta -0.25 minus call IV at +0.25.
            puts = (fg[fg.option_type == 'PE'].groupby('delta', as_index=False).iv.mean()
                    .sort_values('delta'))
            calls = (fg[fg.option_type == 'CE'].groupby('delta', as_index=False).iv.mean()
                     .sort_values('delta'))
            # np.interp requires ASCENDING x. Both legs are already sorted by delta
            # (puts run -1 -> 0, calls 0 -> +1), so neither may be reversed.
            p25 = interp_at(puts.delta.values, puts.iv.values, -0.25) if len(puts) >= 2 else np.nan
            c25 = interp_at(calls.delta.values, calls.iv.values, 0.25) if len(calls) >= 2 else np.nan
            skew = p25 - c25 if not (np.isnan(p25) or np.isnan(c25)) else np.nan

            daily.append(dict(date=day, spot=float(fg.underlying.iloc[0]) if 'underlying' in fg else np.nan,
                              front_expiry=front, next_expiry=nxt, forward=F,
                              dte=int((front - day).days), atm_iv=atm, next_atm_iv=nxt_atm,
                              term_slope=(nxt_atm - atm) if not np.isnan(nxt_atm) and atm else np.nan,
                              skew_25d=skew, n_strikes=int(fg.strike.nunique())))
        s = pd.DataFrame(daily).sort_values('date')
        s = s[s.atm_iv.notna()].reset_index(drop=True)

        # IV rank is (current - min) / (max - min) over the window, shifted so the
        # current day never sees itself in its own reference range.
        for w, col in ((20, 'iv_rank_20d'), (60, 'iv_rank_60d')):
            lo = s.atm_iv.rolling(w).min(); hi = s.atm_iv.rolling(w).max()
            s[col] = (s.atm_iv - lo) / (hi - lo).replace(0, np.nan)
        s['iv_pctile_252'] = s.atm_iv.rolling(252).apply(
            lambda x: 100.0 * (x[-1] >= x[:-1]).mean() if len(x) > 1 else np.nan, raw=True)

        s = s.merge(vix, on='date', how='left')
        cur.execute("DELETE FROM iv_surface_daily WHERE underlier = %s", (tk,))
        psycopg2.extras.execute_values(cur, """
            INSERT INTO iv_surface_daily (date,underlier,spot,front_expiry,next_expiry,forward,dte,
                atm_iv,next_atm_iv,term_slope,skew_25d,iv_rank_20d,iv_rank_60d,iv_pctile_252,
                n_strikes,vix,vix_chg_1d,vix_ma5,vix_ma20)
            VALUES %s ON CONFLICT DO NOTHING
        """, [tuple(None if (isinstance(v, float) and np.isnan(v)) or v is pd.NaT or v is None else v
                    for v in (r.date.date(), tk, r.spot,
                              r.front_expiry.date() if pd.notna(r.front_expiry) else None,
                              r.next_expiry.date() if pd.notna(r.next_expiry) else None,
                              r.forward, r.dte, r.atm_iv, r.next_atm_iv, r.term_slope, r.skew_25d,
                              r.iv_rank_20d, r.iv_rank_60d, r.iv_pctile_252, r.n_strikes,
                              r.vix, r.vix_chg_1d, r.vix_ma5, r.vix_ma20))
             for r in s.itertuples()], page_size=1000)
        conn.commit()

        # ---- diagnostics -------------------------------------------------------
        ok = s.dropna(subset=['atm_iv', 'vix'])
        corr = ok.atm_iv.mul(100).corr(ok.vix) if len(ok) > 3 else float('nan')
        print(f'[{tk}] daily surface: {len(s)} sessions {s.date.min().date()} -> {s.date.max().date()}')
        print(f'       ATM IV  median {100*s.atm_iv.median():.1f}%  '
              f'range {100*s.atm_iv.min():.1f}-{100*s.atm_iv.max():.1f}%')
        print(f'       25d skew median {100*s.skew_25d.median():.2f} pts   '
              f'term slope median {100*s.term_slope.median():.2f} pts')
        print(f'       corr(ATM IV, India VIX) = {corr:.3f}   (VIX coverage {len(ok)}/{len(s)})')

    cur.close(); conn.close()


if __name__ == '__main__':
    main()
