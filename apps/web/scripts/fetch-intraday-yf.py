#!/usr/bin/env python3
"""
Intraday bar ingestion from Yahoo Finance (yfinance).

WHY YAHOO, AND WHAT IT IS AND IS NOT FOR
Measured limits for NSE symbols (probe, 2026-08-05):
    1m  -> 8 days       (useless)
    5m  -> 60 days      (rolling capture only)
    15m -> 60 days
    60m -> exactly 2 years   <- the one that matters

Accuracy against our own bhavcopy daily bars, hourly aggregated to daily:
    high / low : mean error 0.023-0.126%   <- GOOD
    open       : mean error 0.075-0.182%, max 1.01%
    close      : mean error 0.081-0.365%, max 1.90%

So Yahoo's open/close are NOT trustworthy for entry or exit — the gap-fade edge
is only +0.36% and a 0.1% open error is a third of it. But high and low are
accurate, and the intraday PATH is the only thing daily bars cannot give us.

The division of labour is therefore deliberate:
    entry / exit prices  -> bhavcopy (exact opening auction print, already verified)
    intraday path/stops  -> these bars (high/low)

Prices are stored RAW (auto_adjust=False). Adjustment uses our own verified
`corporate_actions.adj_factor`, the same series the rest of the system trusts —
mixing Yahoo's adjustment with ours would double-adjust.

TWO MODES
  backfill (default) — skips tickers already checkpointed, for the one-off history load.
  --refresh          — ignores checkpoints and re-fetches a short recent window.
                       This is what the daily cron uses: after the initial backfill
                       every ticker is checkpointed 'done', so without --refresh a
                       scheduled run would silently do nothing.

WHY THE DAILY RUN MATTERS: Yahoo serves only 60 days of 5-minute history and it
ages out irreversibly. Bars not captured within that window cannot be bought back
from anyone. Each daily run turns a rolling window into a permanent archive.

Usage:
  DATABASE_URL=... python3 scripts/fetch-intraday-yf.py [options]
    --interval 60m|5m|15m     default 60m
    --min-turnover-cr 100     liquidity floor
    --batch 40                symbols per yfinance request
    --period 5d               override the fetch window (default: interval max)
    --refresh                 ignore checkpoints; re-fetch (for the daily cron)
"""

import os, sys, time, math
import psycopg2, psycopg2.extras

try:
    import yfinance as yf
    import pandas as pd
except ImportError:
    sys.exit("pip3 install yfinance pandas")

# Yahoo's hard caps, measured. Requesting more silently returns nothing.
MAX_PERIOD = {'1m': '7d', '5m': '60d', '15m': '60d', '30m': '60d', '60m': '2y', '1h': '2y'}
IST = 'Asia/Kolkata'


def connect():
    url = os.environ.get('DATABASE_URL')
    if not url:
        sys.exit('DATABASE_URL must be set')
    return psycopg2.connect(url)


def ensure_schema(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS intraday_bars (
            ticker   text NOT NULL,
            ts       timestamptz NOT NULL,
            interval text NOT NULL,
            open     double precision,
            high     double precision,
            low      double precision,
            close    double precision,
            volume   bigint,
            source   text NOT NULL DEFAULT 'yfinance',
            PRIMARY KEY (ticker, interval, ts)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS intraday_ts_idx ON intraday_bars (ts)")
    cur.execute("CREATE INDEX IF NOT EXISTS intraday_ticker_ts_idx ON intraday_bars (ticker, ts)")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backfill_progress (
            job text NOT NULL, window_key text NOT NULL, status text NOT NULL,
            rows integer NOT NULL DEFAULT 0, note text,
            completed_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (job, window_key)
        )
    """)


def universe(cur, min_turnover_cr):
    """Liquid names only — the tradeable set, ~700 rather than 3,234."""
    cur.execute("""
        SELECT DISTINCT ticker FROM _turnover
        WHERE date > (CURRENT_DATE - 400) AND t20 >= %s
        ORDER BY ticker
    """, (min_turnover_cr * 1e7,))
    return [r[0] for r in cur.fetchall()]


def done_tickers(cur, job):
    cur.execute("SELECT window_key FROM backfill_progress WHERE job=%s AND status='done'", (job,))
    return {r[0] for r in cur.fetchall()}


def frame_for(data, symbol, multi):
    """Pull one symbol's frame out of a possibly multi-indexed batch result."""
    if not multi:
        return data
    try:
        sub = data.xs(symbol, axis=1, level=1)
    except (KeyError, IndexError):
        return None
    return sub


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--interval', default='60m')
    ap.add_argument('--min-turnover-cr', type=float, default=100.0)
    ap.add_argument('--batch', type=int, default=40)
    ap.add_argument('--period', default=None,
                    help='override fetch window, e.g. 5d for the daily cron')
    ap.add_argument('--refresh', action='store_true',
                    help='ignore checkpoints and re-fetch (required for scheduled runs)')
    a = ap.parse_args()

    interval = a.interval
    min_turnover_cr = a.min_turnover_cr
    batch_size = a.batch

    period = a.period or MAX_PERIOD.get(interval)
    if not period:
        sys.exit(f'unsupported interval {interval}; use one of {list(MAX_PERIOD)}')

    job = f'intraday-yf-{interval}'
    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()
    ensure_schema(cur)
    conn.commit()

    tickers = universe(cur, min_turnover_cr)
    # In refresh mode every ticker is re-fetched: after the initial backfill they
    # are all checkpointed 'done', so honouring checkpoints would be a no-op.
    already = set() if a.refresh else done_tickers(cur, job)
    todo = [t for t in tickers if t not in already]
    print(f'[{job}] {len(tickers)} liquid tickers (>=Rs{min_turnover_cr:g}cr), '
          f'{len(already)} done, {len(todo)} to fetch, period={period}'
          f"{', REFRESH' if a.refresh else ''}", flush=True)
    if not todo:
        print('  nothing to do'); return

    total_rows = 0
    failures = []

    for i in range(0, len(todo), batch_size):
        batch = todo[i:i + batch_size]
        symbols = [f'{t}.NS' for t in batch]
        try:
            data = yf.download(symbols, period=period, interval=interval,
                               progress=False, auto_adjust=False,
                               group_by='column', threads=True)
        except Exception as e:
            print(f'  batch {i//batch_size}: download failed: {str(e)[:90]}', flush=True)
            time.sleep(5)
            continue

        if data is None or len(data) == 0:
            for t in batch:
                failures.append(t)
            continue

        multi = isinstance(data.columns, pd.MultiIndex)

        for t, sym in zip(batch, symbols):
            sub = frame_for(data, sym, multi)
            if sub is None or len(sub) == 0 or 'Close' not in sub.columns:
                failures.append(t)
                cur.execute("""INSERT INTO backfill_progress (job,window_key,status,rows,note)
                               VALUES (%s,%s,'failed',0,'no data')
                               ON CONFLICT (job,window_key) DO UPDATE SET status='failed'""", (job, t))
                continue

            sub = sub.dropna(subset=['Close'])
            if len(sub) == 0:
                failures.append(t); continue

            # Yahoo returns tz-aware timestamps for intraday; normalise to IST so
            # session boundaries line up with everything else in the database.
            idx = sub.index
            if idx.tz is None:
                idx = idx.tz_localize('UTC')
            idx = idx.tz_convert(IST)

            rows = []
            for ts, r in zip(idx, sub.itertuples(index=False)):
                o, h, l, c = r.Open, r.High, r.Low, r.Close
                v = getattr(r, 'Volume', 0)
                if any(x is None or (isinstance(x, float) and math.isnan(x)) for x in (o, h, l, c)):
                    continue
                if v is None or (isinstance(v, float) and math.isnan(v)):
                    v = 0
                rows.append((t, ts.to_pydatetime(), interval,
                             float(o), float(h), float(l), float(c), int(v), 'yfinance'))

            if rows:
                psycopg2.extras.execute_values(cur, """
                    INSERT INTO intraday_bars
                      (ticker, ts, interval, open, high, low, close, volume, source)
                    VALUES %s
                    ON CONFLICT (ticker, interval, ts) DO NOTHING
                """, rows, page_size=1000)
                total_rows += len(rows)

            cur.execute("""INSERT INTO backfill_progress (job,window_key,status,rows,note)
                           VALUES (%s,%s,'done',%s,NULL)
                           ON CONFLICT (job,window_key) DO UPDATE
                             SET status='done', rows=EXCLUDED.rows, completed_at=now()""",
                        (job, t, len(rows)))

        conn.commit()
        print(f'  {min(i+batch_size, len(todo))}/{len(todo)} tickers, {total_rows} bars', flush=True)
        time.sleep(1.5)   # be polite; Yahoo throttles aggressive callers

    cur.execute("SELECT count(*), count(DISTINCT ticker) FROM intraday_bars WHERE interval=%s", (interval,))
    n, nt = cur.fetchone()
    conn.commit()
    print(f'[{job}] done — {total_rows} bars this run; {n} total across {nt} tickers')
    if failures:
        print(f'[{job}] {len(failures)} tickers returned nothing '
              f'(delisted, renamed, or absent from Yahoo): {", ".join(failures[:15])}'
              f'{" ..." if len(failures) > 15 else ""}')
    cur.close(); conn.close()


if __name__ == '__main__':
    main()
