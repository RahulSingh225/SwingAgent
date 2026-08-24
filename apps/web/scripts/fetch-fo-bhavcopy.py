#!/usr/bin/env python3
"""
NSE F&O bhavcopy ingestion — actual daily option prices per strike.

WHY THIS EXISTS
Every attempt to date this trader's fills from a modelled premium failed, because
the premium of a deep-OTM weekly is dominated by implied vol, and IV is exactly the
thing we were assuming. See docs/arpan-trade-analysis.md. Guessing sigma over a
10-20% range either matched no date (40% of options) or matched dozens.

This replaces the model with a lookup. With real per-strike OHLC the inference
becomes model-free and cannot be wrong, only ambiguous:

    a fill at Rs0.60 can only have happened on a session where Low <= 0.60 <= High

It also yields a real per-strike IV surface, which is the input missing from
everything else in this project.

SOURCE
UDiFF format, free and unauthenticated (unlike the rest of nseindia.com, this host
needs no cookie priming — a User-Agent and Referer suffice):

    https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_YYYYMMDD_F_0000.csv.zip

Verified available back to at least 2024-01-15. Non-trading days return a clean
404, which is recorded as 'holiday' rather than a failure so retries skip them.

WHAT IS STORED
~30k rows/day, of which ~38% actually traded. Only traded rows are stored by
default: an untraded strike cannot be somebody's fill, and its settlement price is
theoretical. Pass --include-untraded to keep the rest (they carry OI and settlement).
At ~11.5k rows/day that is ~2.9M rows/year — smaller than intraday_bars.

DATA TRAP — `settle` ON EXPIRY DAY
On an option's expiry date NSE puts the UNDERLYING's settlement price into
SttlmPric, not the option's value. Verified: 12,070 of 12,070 expiry-day rows have
settle == underlying. Computing option P&L from `settle` on expiry day yields
nonsense (a 24550 PE showing settle=24614.90). Use `close`, or intrinsic value
against `underlying`, for expiry-day valuation. Off expiry day `settle` is fine.

Usage:
  DATABASE_URL=... python3 scripts/fetch-fo-bhavcopy.py --from 2025-08-01 --to 2026-08-31
    --from / --to           inclusive date range (required)
    --symbols NIFTY,SENSEX  restrict to these underlyings
    --include-untraded      also store rows with zero volume
    --refresh               ignore checkpoints and re-fetch
"""

import os, sys, io, time, zipfile, argparse, datetime as dt
import urllib.request, urllib.error
import psycopg2, psycopg2.extras

try:
    import pandas as pd
except ImportError:
    sys.exit("pip install pandas")

URL = ("https://nsearchives.nseindia.com/content/fo/"
       "BhavCopy_NSE_FO_0_0_0_{ymd}_F_0000.csv.zip")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
JOB = "fo-bhavcopy"

# Futures rows have no strike and no option type. Postgres cannot put NULLs in a
# primary key, so they get sentinels rather than a separate table.
NO_STRIKE = -1.0
NO_OPTTYPE = "FUT"


def connect():
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL must be set")
    return psycopg2.connect(url)


def ensure_schema(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS fo_bhavcopy (
            trade_date   date             NOT NULL,
            ticker       text             NOT NULL,
            expiry       date             NOT NULL,
            strike       double precision NOT NULL,
            option_type  text             NOT NULL,
            instr_type   text             NOT NULL,
            open         double precision,
            high         double precision,
            low          double precision,
            close        double precision,
            settle       double precision,
            underlying   double precision,
            oi           bigint,
            chg_oi       bigint,
            volume       bigint,
            turnover     double precision,
            n_trades     bigint,
            lot_size     integer,
            PRIMARY KEY (trade_date, ticker, expiry, strike, option_type)
        )
    """)
    # The matching query is "which sessions could this fill have happened on",
    # i.e. filter by contract then scan its price range across dates.
    cur.execute("""CREATE INDEX IF NOT EXISTS fo_contract_idx
                   ON fo_bhavcopy (ticker, expiry, strike, option_type, trade_date)""")
    cur.execute("CREATE INDEX IF NOT EXISTS fo_date_idx ON fo_bhavcopy (trade_date)")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS backfill_progress (
            job text NOT NULL, window_key text NOT NULL, status text NOT NULL,
            rows integer NOT NULL DEFAULT 0, note text,
            completed_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (job, window_key)
        )
    """)


def fetch_zip(day, tries=4):
    """Return raw CSV bytes, or None when the day is not a trading day (404)."""
    url = URL.format(ymd=day.strftime("%Y%m%d"))
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Referer": "https://www.nseindia.com/",
        "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9",
    })
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                blob = r.read()
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                return z.read(z.namelist()[0])
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None                     # weekend or exchange holiday
            # 403/429 are throttling, not permanent failure — back off and retry.
            if attempt == tries - 1:
                raise
            time.sleep(3 * (attempt + 1))
        except (urllib.error.URLError, zipfile.BadZipFile, TimeoutError):
            if attempt == tries - 1:
                raise
            time.sleep(3 * (attempt + 1))
    return None


def to_rows(csv_bytes, symbols, include_untraded):
    d = pd.read_csv(io.BytesIO(csv_bytes))
    if not include_untraded:
        d = d[d.TtlTradgVol > 0]
    if symbols:
        d = d[d.TckrSymb.isin(symbols)]
    if len(d) == 0:
        return []

    d = d.assign(
        StrkPric=d.StrkPric.fillna(NO_STRIKE),
        OptnTp=d.OptnTp.fillna(NO_OPTTYPE),
    )
    # A contract can legitimately appear once per (date, ticker, expiry, strike,
    # type); anything else would silently lose rows to the ON CONFLICT below.
    key = ["TradDt", "TckrSymb", "XpryDt", "StrkPric", "OptnTp"]
    d = d.drop_duplicates(subset=key, keep="first")

    def num(col):
        return pd.to_numeric(d[col], errors="coerce") if col in d else pd.Series([None] * len(d))

    out = list(zip(
        d.TradDt, d.TckrSymb, d.XpryDt, d.StrkPric, d.OptnTp, d.FinInstrmTp,
        num("OpnPric"), num("HghPric"), num("LwPric"), num("ClsPric"),
        num("SttlmPric"), num("UndrlygPric"),
        num("OpnIntrst"), num("ChngInOpnIntrst"), num("TtlTradgVol"),
        num("TtlTrfVal"), num("TtlNbOfTxsExctd"), num("NewBrdLotQty"),
    ))
    clean = []
    for r in out:
        r = list(r)
        for i in (12, 13, 14, 16, 17):          # integer-ish columns
            r[i] = None if pd.isna(r[i]) else int(r[i])
        for i in (6, 7, 8, 9, 10, 11, 15):
            r[i] = None if pd.isna(r[i]) else float(r[i])
        clean.append(tuple(r))
    return clean


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="dfrom", required=True)
    ap.add_argument("--to", dest="dto", required=True)
    ap.add_argument("--symbols", default=None)
    ap.add_argument("--include-untraded", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    a = ap.parse_args()

    d0 = dt.date.fromisoformat(a.dfrom)
    d1 = dt.date.fromisoformat(a.dto)
    if d1 < d0:
        sys.exit("--to is before --from")
    symbols = set(s.strip().upper() for s in a.symbols.split(",")) if a.symbols else None

    conn = connect(); conn.autocommit = False
    cur = conn.cursor()
    ensure_schema(cur); conn.commit()

    cur.execute("SELECT window_key FROM backfill_progress WHERE job=%s AND status IN ('done','holiday')", (JOB,))
    done = set() if a.refresh else {r[0] for r in cur.fetchall()}

    # Weekends are skipped locally; exchange holidays are only knowable from the 404.
    days = []
    d = d0
    while d <= d1:
        if d.weekday() < 5 and d.isoformat() not in done:
            days.append(d)
        d += dt.timedelta(days=1)

    print(f"[{JOB}] {len(days)} sessions to fetch ({d0} -> {d1})"
          f"{', REFRESH' if a.refresh else ''}"
          f"{', symbols=' + ','.join(sorted(symbols)) if symbols else ''}", flush=True)
    if not days:
        print("  nothing to do"); return

    total = holidays = failed = 0
    for i, day in enumerate(days, 1):
        key = day.isoformat()
        try:
            blob = fetch_zip(day)
        except Exception as e:
            failed += 1
            print(f"  {key}  FAILED: {str(e)[:80]}", flush=True)
            cur.execute("""INSERT INTO backfill_progress (job,window_key,status,rows,note)
                           VALUES (%s,%s,'failed',0,%s)
                           ON CONFLICT (job,window_key) DO UPDATE
                             SET status='failed', note=EXCLUDED.note""",
                        (JOB, key, str(e)[:200]))
            conn.commit()
            continue

        if blob is None:
            holidays += 1
            cur.execute("""INSERT INTO backfill_progress (job,window_key,status,rows,note)
                           VALUES (%s,%s,'holiday',0,'404 - not a trading day')
                           ON CONFLICT (job,window_key) DO UPDATE SET status='holiday'""",
                        (JOB, key))
            conn.commit()
            continue

        rows = to_rows(blob, symbols, a.include_untraded)
        if rows:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO fo_bhavcopy
                  (trade_date,ticker,expiry,strike,option_type,instr_type,
                   open,high,low,close,settle,underlying,
                   oi,chg_oi,volume,turnover,n_trades,lot_size)
                VALUES %s
                ON CONFLICT (trade_date,ticker,expiry,strike,option_type) DO NOTHING
            """, rows, page_size=2000)
        total += len(rows)
        cur.execute("""INSERT INTO backfill_progress (job,window_key,status,rows,note)
                       VALUES (%s,%s,'done',%s,NULL)
                       ON CONFLICT (job,window_key) DO UPDATE
                         SET status='done', rows=EXCLUDED.rows, completed_at=now()""",
                    (JOB, key, len(rows)))
        conn.commit()
        if i % 10 == 0 or i == len(days):
            print(f"  {i}/{len(days)}  {key}  +{len(rows)} rows  (total {total})", flush=True)
        time.sleep(1.0)                          # be polite to the archive host

    cur.execute("SELECT count(*), count(DISTINCT trade_date), min(trade_date), max(trade_date) FROM fo_bhavcopy")
    n, nd, lo, hi = cur.fetchone()
    conn.commit()
    print(f"\n[{JOB}] {total} rows this run; table now {n} rows over {nd} sessions ({lo} -> {hi})")
    if holidays:
        print(f"[{JOB}] {holidays} non-trading days recorded")
    if failed:
        print(f"[{JOB}] {failed} sessions FAILED — re-run to retry", flush=True)
        sys.exit(1)
    cur.close(); conn.close()


if __name__ == "__main__":
    main()
