#!/usr/bin/env python3
"""
Phase A — resolve a broker P&L export's fills to candidate trading sessions,
then overlay the volatility regime that was actually in force.

THE PROBLEM THIS SOLVES
The export has no trade dates. One row is one symbol's entire lifetime: quantity,
average buy price, average sell price. Every attempt to recover the dates by
modelling the premium failed, because a deep-OTM weekly's price is dominated by
implied vol and sigma was the thing being assumed.

THE METHOD — A LOOKUP, NOT A MODEL
With real per-strike OHLC from fo_bhavcopy the constraint is arithmetic:

    a fill at Rs0.60 can only have happened on a session where Low <= 0.60 <= High

No Greeks, no sigma, no rate. This cannot produce a wrong date -- only an ambiguous
one -- which is the opposite failure mode to a Black-Scholes reconstruction, and the
safe one.

DIRECTION FALLS OUT FOR FREE, WHERE THE SETS DO NOT OVERLAP
If every candidate buy session precedes every candidate sell session, the position
was LONG. If every sell precedes every buy, it was SHORT. Where the windows overlap
the row stays ambiguous and is reported as such rather than guessed. This is a
model-free version of the inference that was rejected as circular earlier: there,
the higher price of any winner mechanically mapped to an earlier date, so the method
relabelled winners as shorts. Here the price ranges are observed, not derived, so
that particular circularity cannot arise.

A ZERO PRICE IS NOT A FILL
`Buy Avg = 0` means a short expired worthless (nothing was paid to close);
`Sell Avg = 0` means a long expired worthless. Those legs are settlements, not
market trades, and are classified directly rather than searched for.

WEIGHTING, WHEN AGGREGATING REGIME
A row with 4 candidate sessions must not count 4 times against a row with 1. Each
row contributes weight 1, split evenly across its candidates.

Usage:
  DATABASE_URL=... python3 scripts/resolve-arpan-fills.py [--workbook PATH]
"""

import os, sys, argparse
from collections import defaultdict

import pandas as pd
import numpy as np
import psycopg2

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
from option_symbols import parse_option_symbol, resolve_expiry   # noqa: E402

DEFAULT_WB = 'resources/Arpan Sengupta (Blu_Dragon) – Verified P&L Trades.xlsx'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workbook', default=DEFAULT_WB)
    a = ap.parse_args()

    url = os.environ.get('DATABASE_URL')
    if not url:
        sys.exit('DATABASE_URL must be set')
    conn = psycopg2.connect(url, connect_timeout=20)

    wb = pd.read_excel(a.workbook, sheet_name='All Trades')
    listed = defaultdict(list)
    ex = pd.read_sql('SELECT DISTINCT ticker, expiry FROM fo_bhavcopy', conn)
    for t, e in zip(ex.ticker, pd.to_datetime(ex.expiry).dt.date):
        listed[t].append(e)

    parsed = []
    for _, r in wb.iterrows():
        p = parse_option_symbol(str(r.Symbol))
        if not p:
            continue
        p['expiry_resolved'] = resolve_expiry(p, listed.get(p['underlying'], []))
        p['sym'] = r.Symbol
        p['buy'] = float(r['Buy Avg'])
        p['sell'] = float(r['Sell Avg'])
        p['pnl'] = float(r['Gross Realised P&L'])
        parsed.append(p)
    t = pd.DataFrame(parsed)
    print(f'option rows parsed: {len(t)}')

    # One pull of every contract he touched, indexed for lookup.
    tickers = sorted({u for u in t.underlying if u in listed})
    bh = pd.read_sql("""SELECT ticker, expiry, strike, option_type, trade_date, low, high, volume
                        FROM fo_bhavcopy WHERE ticker = ANY(%s)""", conn, params=(tickers,))
    bh['expiry'] = pd.to_datetime(bh.expiry).dt.date
    bh['trade_date'] = pd.to_datetime(bh.trade_date).dt.date
    idx = defaultdict(list)
    for r in bh.itertuples():
        idx[(r.ticker, r.expiry, float(r.strike), r.option_type)].append(
            (r.trade_date, float(r.low), float(r.high)))
    for k in idx:
        idx[k].sort()
    print(f'contracts indexed: {len(idx):,} from {len(bh):,} bhavcopy rows')

    def candidates(bars, px):
        return [d for d, lo, hi in bars if lo <= px <= hi]

    recs = []
    for r in t.itertuples():
        if r.expiry_resolved is None:
            recs.append(dict(sym=r.sym, status='no_contract', side=None,
                             nb=0, ns=0, pnl=r.pnl)); continue
        bars = idx.get((r.underlying, r.expiry_resolved, float(r.strike), r.option_type))
        if not bars:
            recs.append(dict(sym=r.sym, status='no_bars', side=None,
                             nb=0, ns=0, pnl=r.pnl)); continue

        # Settlement legs are not fills.
        buy_settle = r.buy == 0
        sell_settle = r.sell == 0
        bc = [] if buy_settle else candidates(bars, r.buy)
        sc = [] if sell_settle else candidates(bars, r.sell)

        if buy_settle:
            side, status = 'SHORT', 'settled'
        elif sell_settle:
            side, status = 'LONG', 'settled'
        elif bc and sc:
            if max(bc) < min(sc):
                side, status = 'LONG', 'resolved'
            elif max(sc) < min(bc):
                side, status = 'SHORT', 'resolved'
            else:
                side, status = None, 'overlapping'
        else:
            side, status = None, 'price_not_found'

        recs.append(dict(sym=r.sym, status=status, side=side, nb=len(bc), ns=len(sc),
                         pnl=r.pnl, buy_c=bc, sell_c=sc, under=r.underlying))
    R = pd.DataFrame(recs)

    print('\n=== fill resolution ===')
    print(R.status.value_counts().to_string())
    got = R[R.status.isin(['resolved', 'overlapping', 'settled'])]
    print(f'\ncontracts located in bhavcopy: {len(got)} of {len(R)}')

    print('\n=== DIRECTION, model-free ===')
    dd = R[R.side.notna()]
    print(dd.groupby(['status', 'side']).agg(n=('sym', 'size'), net=('pnl', 'sum')).to_string())
    print('\noverall:')
    print(dd.groupby('side').agg(n=('sym', 'size'), net=('pnl', 'sum'),
                                 win=('pnl', lambda s: round(100 * (s > 0).mean(), 1))).to_string())

    print('\n=== CIRCULARITY CHECK — is `resolved` direction just a relabelling of P&L? ===')
    rr = R[R.status == 'resolved']
    if len(rr):
        wl = rr[rr.pnl > 0]; ll = rr[rr.pnl <= 0]
        print(f"  winners called SHORT: {(wl.side=='SHORT').sum()}/{len(wl)}"
              f"  ({100*(wl.side=='SHORT').mean():.0f}%)")
        print(f"  losers  called LONG : {(ll.side=='LONG').sum()}/{len(ll)}"
              f"  ({100*(ll.side=='LONG').mean():.0f}%)")
        print('  Near-100% on both means the ordering is tracking profit, not side:')
        print('  on a decaying option the higher price of ANY winner sits earlier, so a')
        print('  winning SHORT and a winning LONG are not separable this way. Only the')
        print("  `settled` rows (a zero leg) carry direction that cannot be confounded.")

    res = R[R.status == 'resolved']
    if len(res):
        print(f'\ncandidate-session tightness among resolved rows:')
        print(f'  median buy candidates  {res.nb.median():.0f}   median sell candidates {res.ns.median():.0f}')
        print(f'  buy leg pinned to ONE session: {(res.nb == 1).sum()}/{len(res)}')

    # ---- regime overlay -----------------------------------------------------
    reg = pd.read_sql("""SELECT date, expansion_and, expansion_or, regime_dir,
                                regime_level_fixed, vix_close, fwd_abs_5
                         FROM regime_daily WHERE underlier='NIFTY'""", conn)
    reg['date'] = pd.to_datetime(reg.date).dt.date
    reg = reg.set_index('date')

    w = defaultdict(float)
    for r in R.itertuples():
        bc = getattr(r, 'buy_c', None); sc = getattr(r, 'sell_c', None)
        cands = (bc if isinstance(bc, list) else []) + (sc if isinstance(sc, list) else [])
        if not cands:
            continue
        for d in cands:
            w[d] += 1.0 / len(cands)
    if not w:
        print('\nno candidate sessions to overlay'); return

    ws = pd.Series(w).sort_index()
    ws = ws[ws.index.isin(reg.index)]
    j = reg.loc[ws.index].copy()
    j['w'] = ws.values
    base = reg.loc[reg.index.isin(pd.Index(sorted(set(reg.index) &
             set(pd.date_range(min(ws.index), max(ws.index)).date))))]

    print('\n=== WHAT CLIMATE WAS HE ACTUALLY TRADING IN? ===')
    print(f'{len(ws)} distinct candidate sessions, {ws.sum():.0f} trade-equivalents; '
          f'baseline = {len(base)} sessions over the same span\n')
    tot = j.w.sum()
    for col in ('expansion_and', 'expansion_or'):
        share = 100 * j.loc[j[col] == True, 'w'].sum() / tot
        b = 100 * (base[col] == True).mean()
        print(f'  {col:<14} his {share:5.1f}%   baseline {b:5.1f}%   lift {share/b if b else 0:.2f}x')
    for col in ('regime_dir', 'regime_level_fixed'):
        print(f'\n  {col}:')
        hs = j.groupby(col).w.sum() / tot * 100
        bs = base[col].value_counts(normalize=True) * 100
        for k in hs.index:
            print(f'    {str(k):<10} his {hs[k]:5.1f}%   baseline {bs.get(k, 0):5.1f}%')
    print(f'\n  mean India VIX on his sessions '
          f'{np.average(j.vix_close, weights=j.w):.2f}   baseline {base.vix_close.mean():.2f}')
    conn.close()


if __name__ == '__main__':
    main()
