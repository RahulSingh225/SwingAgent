#!/usr/bin/env python3
"""
R1 test — is there really a premium ceiling for option BUYERS?

THE CLAIM (docs/arpan-trade-analysis.md, R1)
"Never open an option position above ~Rs300 premium." It came from a trader's book
where sub-Rs300 entries made +Rs3.85M and Rs300+ entries lost -Rs2.14M.

WHY THIS TEST IS DIFFERENT FROM THE LAST ONE
The earlier version priced options with Black-Scholes at an assumed sigma. The
answer flipped sign between sigma multipliers 1.0 and 1.3, so nothing could be
concluded. This uses REAL traded prices from fo_bhavcopy — no model, no IV guess.

THE CONFOUND THIS EXISTS TO SETTLE
Premium is not a property of a trade, it is a consequence of moneyness and time to
expiry. A Rs5 option is far OTM or nearly expired; a Rs300 option is near ATM or
long dated. So "premium ceiling" may be nothing more than a clumsy proxy for
moneyness. Results are therefore reported by premium, by moneyness, and CROSSED --
if the premium effect vanishes inside moneyness buckets, R1 should be restated.

MECHANICS
  entry : close on day t (a real traded price)
  exit  : close H sessions later, or intrinsic vs `underlying` if expiry arrives first
  NOTE  : expiry-day `settle` is unusable -- NSE overwrites it with the underlying's
          settlement price. Intrinsic is computed against `underlying` instead.

FRICTION IS THE WHOLE BALLGAME FOR CHEAP OPTIONS
The tick is Rs0.05. On a Rs0.50 option that is a 10% spread, so a round trip costs
~20% before anything moves. Close-to-close returns ignore this and will flatter the
cheap buckets enormously. Both gross and net are reported; net assumes a half-spread
of max(one tick, 0.5% of price) per side.

Usage:
  DATABASE_URL=... python3 scripts/test-premium-ceiling.py [--hold 5] [--min-volume 1000]
"""

import os, sys, argparse
import psycopg2
import pandas as pd
import numpy as np

TICK = 0.05


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hold', type=int, default=5, help='sessions held')
    ap.add_argument('--min-volume', type=int, default=1000)
    ap.add_argument('--ticker', default='NIFTY')
    a = ap.parse_args()

    url = os.environ.get('DATABASE_URL')
    if not url:
        sys.exit('DATABASE_URL must be set')
    conn = psycopg2.connect(url, connect_timeout=15)

    d = pd.read_sql(f"""
        SELECT trade_date, expiry, strike, option_type, close, volume, underlying
        FROM fo_bhavcopy
        WHERE ticker = %s AND option_type IN ('CE','PE')
          AND close > 0 AND underlying > 0
        ORDER BY expiry, strike, option_type, trade_date
    """, conn, params=(a.ticker,))
    if len(d) == 0:
        sys.exit('no rows -- run fetch-fo-bhavcopy.py first')
    d['trade_date'] = pd.to_datetime(d.trade_date)
    d['expiry'] = pd.to_datetime(d.expiry)

    # Forward price within each contract's own life.
    g = d.groupby(['expiry', 'strike', 'option_type'], sort=False)
    d['exit_close'] = g.close.shift(-a.hold)
    d['exit_date'] = g.trade_date.shift(-a.hold)
    d['last_close'] = g.close.transform('last')
    d['last_under'] = g.underlying.transform('last')
    d['last_date'] = g.trade_date.transform('max')

    # If the contract expires inside the holding window, settle at intrinsic.
    expires_first = d.exit_close.isna() & (d.last_date > d.trade_date)
    intrinsic = np.where(d.option_type == 'CE',
                         np.maximum(0.0, d.last_under - d.strike),
                         np.maximum(0.0, d.strike - d.last_under))
    d['exit_px'] = np.where(expires_first, intrinsic, d.exit_close)
    d = d[d.exit_px.notna() & (d.volume >= a.min_volume)].copy()

    d['gross'] = 100.0 * (d.exit_px / d.close - 1)
    # Half-spread per side, paid on entry and exit.
    hs_in = np.maximum(TICK, 0.005 * d.close) / d.close
    hs_out = np.maximum(TICK, 0.005 * d.exit_px.clip(lower=0.05)) / d.exit_px.clip(lower=0.05)
    d['net'] = 100.0 * ((d.exit_px * (1 - hs_out)) / (d.close * (1 + hs_in)) - 1)

    d['dte'] = (d.expiry - d.trade_date).dt.days
    # Signed distance from spot: positive = out of the money.
    raw = 100.0 * (d.strike / d.underlying - 1)
    d['otm'] = np.where(d.option_type == 'CE', raw, -raw)

    d['prem_b'] = pd.cut(d.close, [0, 1, 5, 20, 50, 100, 300, 1e9],
                         labels=['<1', '1-5', '5-20', '20-50', '50-100', '100-300', '300+'])
    d['otm_b'] = pd.cut(d.otm, [-99, -2, -0.5, 0.5, 2, 5, 99],
                        labels=['ITM>2%', 'ITM.5-2%', 'ATM+-.5%', 'OTM.5-2%', 'OTM2-5%', 'OTM>5%'])

    print(f"R1 TEST -- {a.ticker} option buys, real bhavcopy prices")
    print(f"hold {a.hold} sessions, min volume {a.min_volume}, "
          f"{d.trade_date.min().date()} to {d.trade_date.max().date()}")
    print(f"n = {len(d):,} contract-days\n")

    def block(col, label):
        t = d.groupby(col, observed=True).agg(
            n=('gross', 'size'), med_prem=('close', 'median'),
            gross=('gross', 'mean'), net=('net', 'mean'),
            win=('net', lambda s: 100 * (s > 0).mean()))
        print(f"=== by {label} ===")
        print(t.round(1).to_string(), '\n')

    block('prem_b', 'ENTRY PREMIUM  (this is R1)')
    block('otm_b', 'MONEYNESS  (the confound)')

    print("=== premium WITHIN moneyness -- does R1 survive the control? ===")
    x = d.pivot_table(index='otm_b', columns='prem_b', values='net',
                      aggfunc='mean', observed=True)
    print(x.round(1).to_string())
    print("\n(if each ROW is flat, premium adds nothing beyond moneyness)")

    cnt = d.pivot_table(index='otm_b', columns='prem_b', values='net',
                        aggfunc='size', observed=True)
    print("\ncell counts:")
    print(cnt.to_string())
    conn.close()


if __name__ == '__main__':
    main()
