# Migration Runbook — m6i.xlarge + Kite Intraday

**Target:** m6i.xlarge (4 vCPU / 16 GB) with Postgres already running.
**Companion:** [deployment-and-intelligence.md](deployment-and-intelligence.md)
for the *why*; this is the *how*.

---

## 0. Before you start

On the laptop, reclaim ~40 GB (the DB is only 5.9 GB; the rest is Docker cruft):

```bash
docker system prune -a --volumes
```

**Storage check on the server.** Whatever volume Postgres already lives on needs
headroom for: 6 GB (restore) + 2 GB (derived tables) + **8–12 GB (5-min intraday)**
+ WAL and working space. Budget **60 GB free** minimum. If the existing Postgres is
on the root EBS volume, verify its size before restoring — running out of disk
mid-backfill corrupts nothing but wastes hours.

```bash
df -h                       # confirm free space
psql -c "SHOW data_directory;"
```

---

## 1. Create the database

Postgres is already running, so no container needed.

```bash
sudo -u postgres psql <<'SQL'
CREATE USER marketos WITH PASSWORD 'CHANGE_ME';
CREATE DATABASE marketos OWNER marketos;
GRANT ALL PRIVILEGES ON DATABASE marketos TO marketos;
SQL
```

**Do not expose 5432 to the internet.** Keep `listen_addresses = 'localhost'` and
reach it over SSH tunnel or Tailscale. There is no authentication story in this
codebase beyond basic-auth on the web app.

---

## 2. Tune Postgres for 16 GB

Defaults assume a shared machine and will make the intraday tables crawl. In
`postgresql.conf`:

```
shared_buffers = 4GB              # ~25% of RAM
effective_cache_size = 12GB       # what the OS will cache; not an allocation
work_mem = 64MB                   # per sort/hash — the ledger queries are sort-heavy
maintenance_work_mem = 1GB        # index builds after restore
max_wal_size = 4GB                # fewer checkpoints during bulk load
random_page_cost = 1.1            # SSD, not spinning disk
effective_io_concurrency = 200
```

`sudo systemctl restart postgresql`

> `work_mem` is **per operation**, not per connection. 64 MB × several concurrent
> sorts is fine at 4 vCPU; do not raise it much further on 16 GB.

---

## 3. Transfer and restore

The dump excludes derived tables (`_*`, `gap_intraday`) — ~1.6 GB that rebuilds
from scripts in a few minutes, so shipping it would be wasted transfer.

```bash
# On the laptop
docker exec marketos-postgres pg_dump -U marketos -d marketos \
  --exclude-table='_*' --exclude-table='gap_intraday' \
  -Fc -Z6 -f /tmp/marketos.dump
docker cp marketos-postgres:/tmp/marketos.dump ./marketos.dump   # ~478 MB
scp marketos.dump user@server:/tmp/

# On the server
pg_restore -U marketos -d marketos -j 4 --no-owner /tmp/marketos.dump
```

`-j 4` parallelises across the 4 vCPUs. Expect minutes, not hours.

### Verify the restore before trusting it

```sql
SELECT 'announcements_raw', count(*) FROM announcements_raw   -- expect 1,324,026
UNION ALL SELECT 'eod_prices', count(*) FROM eod_prices       -- expect ~2,956,146
UNION ALL SELECT 'corporate_actions', count(*) FROM corporate_actions  -- 25,503
UNION ALL SELECT 'order_values', count(*) FROM order_values;  -- 7,325
```

---

## 4. Rebuild what was excluded

Order matters: `eod_prices_adj` is a materialised view over `eod_prices` +
`corporate_actions`, and the derived tables sit on top of it.

```bash
cd apps/web
export DATABASE_URL=postgres://marketos:CHANGE_ME@localhost:5432/marketos

node scripts/detect-split-dates.ts        # effective_date per corporate action
node scripts/build-adjusted-prices.ts     # eod_prices_adj — EXITS NONZERO IF VERIFICATION FAILS
node scripts/rebuild-derived-tables.ts    # _sessions, _turnover, _volratio, _nifty, _typed_events
```

`build-adjusted-prices.ts` self-verifies: every 10:1 split must show a ~−90% raw
gap and ~0% adjusted gap. **If it exits non-zero, stop** — every downstream number
depends on it.

---

## 5. Restore the cron pipeline

```bash
export ENABLE_JOBS=true
```

Existing schedule (IST): poll-feeds every 15 min 08:00–18:45, bhavcopy 18:45,
fii-dii 19:30, screener 19:45, brief 20:00.

**Add a liveness check.** The recurring failure in this project has been a
pipeline that silently stopped — the original one sat dead for a month. Alert on
*silence*, not just errors:

```sql
-- Should always be within ~1 trading day. Alert if not.
SELECT max(date) FROM eod_prices;
SELECT max(announced_at) FROM announcements_raw;
```

---

## 6. Kite intraday

### Step 1 — Probe first. Do not skip this.

Documented limits change and vary by plan. Historical intraday requires the
paid historical-data add-on (~₹2,000/month; verify current pricing).

```bash
export KITE_API_KEY=...
export KITE_ACCESS_TOKEN=...        # expires daily — see below
node scripts/kite-probe.ts RELIANCE
```

This reports, for your key: how far back each interval goes, the largest window
accepted per request, and candles per session (5-min should be ~75).

**The answer determines the whole plan.** If deep 5-minute history is unavailable,
historical backfill is impossible and forward capture is the only route — which
costs months, and every day of delay is a day of data that cannot be bought later.

### Step 2 — Map symbols to instrument tokens

```bash
node scripts/kite-instruments.ts
```

Historical data is keyed on `instrument_token`, not symbol. Re-run weekly; tokens
change on corporate events. It reports coverage of the liquid universe — investigate
any gap before ingesting.

### Step 3 — Backfill the liquid universe

```bash
node scripts/backfill-intraday.ts 2024-01-01 2026-08-05 5minute 60 100
#                                 from        to         interval win  minTurnoverCr
```

Scoped to ~696 names with ≥₹100cr turnover: **~93M rows, 8–12 GB** for 7 years.
Ingesting all 3,234 tickers would cost ~5× for names that fail the liquidity
filter anyway.

Resumable per (ticker, window) via `backfill_progress`. At ~3 requests/second this
is a multi-hour job — run it under `nohup`/`tmux`.

### The access-token trap

**Kite access tokens expire every morning (~06:00 IST).** Only `api_key` and
`api_secret` are durable; the access token comes from a daily browser login flow.

`scripts/lib/kite.ts` throws `KiteAuthError` on 403 and the backfill **exits with
code 2** rather than continuing. This is deliberate: a stale token would otherwise
produce an empty backfill that looks like a completed one. Refresh the token and
re-run — it resumes from the checkpoint.

For unattended operation you need a small token-refresh step in the daily cron
*before* any Kite job runs. That is not built yet.

---

## 6b. Daily intraday capture on the Linux server

**Why this is urgent rather than optional:** Yahoo serves only 60 days of
5-minute history and it ages out irreversibly. Bars not captured inside that
window cannot be bought back from any vendor at any price. Every day the cron is
not running is a day of data permanently lost.

The capture job needs **only Python** — no Node, no Next.js, no repo checkout.
Two files and three packages.

### Step 1 — Dependencies (use a venv)

Ubuntu 24.04 / Debian 12 ship Python 3.12 marked **externally managed** (PEP 668),
so `pip3 install --user` fails with `error: externally-managed-environment`.

**Do not use `--break-system-packages`.** This box also runs
`collection_platform`; mutating the system Python risks breaking an unrelated
application to save one command.

```bash
sudo apt-get update && sudo apt-get install -y python3-venv util-linux
sudo mkdir -p /opt/marketos && sudo chown "$USER" /opt/marketos
python3 -m venv /opt/marketos/venv
/opt/marketos/venv/bin/pip install --upgrade pip
/opt/marketos/venv/bin/pip install yfinance pandas psycopg2-binary
```

The capture script **auto-detects `/opt/marketos/venv/bin/python3`** — no cron
configuration needed. Override with `VENV_PY=` or `PY=` if you put it elsewhere.

If the interpreter is missing its dependencies the script **exits 1 with
instructions** rather than running and capturing nothing. Verified:

```
FATAL: /opt/marketos/venv/bin/python3 is missing yfinance/pandas/psycopg2.
       Create the venv:  python3 -m venv /opt/marketos/venv
       Then:             /opt/marketos/venv/bin/pip install yfinance pandas psycopg2-binary
```

`util-linux` provides `flock`. The script warns and continues without it, but
with it you get proper protection against overlapping runs.

### Step 2 — Install the two files

```bash
sudo mkdir -p /opt/marketos/apps/web/scripts /var/log/marketos
sudo chown -R "$USER" /opt/marketos /var/log/marketos
```

From the laptop:

```bash
cd /Users/spacempact/Desktop/git/SwingAgent/apps/web
scp scripts/fetch-intraday-yf.py scripts/daily-intraday-capture.sh \
    user@52.66.231.60:/opt/marketos/apps/web/scripts/
```

### Step 3 — Credentials

```bash
cat > /opt/marketos/apps/web/.env <<'EOF'
DATABASE_URL=postgresql://marketos:YOUR_PASSWORD@localhost:5432/dataset
EOF
chmod 600 /opt/marketos/apps/web/.env
chmod +x /opt/marketos/apps/web/scripts/daily-intraday-capture.sh
```

Use `localhost` here, not the public IP — the job runs on the same box as
Postgres, so it should never traverse the network.

### Step 4 — Test before scheduling

```bash
/opt/marketos/apps/web/scripts/daily-intraday-capture.sh
echo "exit code: $?"
tail -40 /var/log/marketos/intraday-$(date +%F).log
```

Expect ~10–15 minutes for ~700 tickers across both intervals, ending with
`coverage 5m: … through <today>` and `done rc=0`.

### Step 5 — Schedule it

NSE closes 15:30 IST and Yahoo settles roughly 30–60 minutes later, so **17:00 IST**
is a safe slot. Check the server's clock first — AWS defaults to UTC:

```bash
timedatectl | grep "Time zone"
```

```bash
crontab -e
```

```cron
# Daily intraday capture — 17:00 IST, weekdays.
# CRON_TZ makes the schedule explicit regardless of the server's zone.
CRON_TZ=Asia/Kolkata
0 17 * * 1-5 /opt/marketos/apps/web/scripts/daily-intraday-capture.sh
```

If your cron does not support `CRON_TZ` (older Debian/Ubuntu cron does), use the
UTC equivalent instead — 17:00 IST is **11:30 UTC**:

```cron
30 11 * * 1-5 /opt/marketos/apps/web/scripts/daily-intraday-capture.sh
```

### Step 6 — Alert on silence, not just errors

A stopped pipeline is this project's recurring failure — the original one sat dead
for a month. Errors are loud; silence is not. Check staleness daily:

```sql
SELECT interval,
       max((ts AT TIME ZONE 'Asia/Kolkata')::date) AS last_bar,
       CURRENT_DATE - max((ts AT TIME ZONE 'Asia/Kolkata')::date) AS days_stale
FROM intraday_bars GROUP BY interval;
```

`days_stale` above 4 on a weekday means the capture has stopped. Wire that to
Telegram or email — it matters more than any individual run failing, because a
failed run is visible and a job that quietly stopped is not.

### Notes on behaviour

- `--refresh` is **required** for scheduled runs and is already in the script.
  Without it every ticker reads as checkpointed `done` from the initial backfill
  and the job silently does nothing.
- The 5-day fetch window self-heals: one or two missed days are picked up by the
  next successful run, no manual intervention.
- 5-minute runs first, deliberately — it is the interval that expires, so a later
  failure never costs the irreplaceable data.
- Logs rotate at 30 days.

---

## 7. What to do once intraday lands

In priority order — the first item is why this data exists:

1. **Test a stop loss on the gap fade.** [gap-fade-findings.md](gap-fade-findings.md):
   mean +0.36%, worst trade −51.9%, which caps position size so low the strategy is
   pointless without a stop. Whether price touched −5% before closing +1% is
   unknowable from daily bars. **This single question decides whether the only live
   candidate is tradeable.**
2. **Validate fill quality** — does the opening-auction print match what you'd get?
3. Opening-range and first-30/60/90-minute rules.
4. Time-based exits instead of holding to close.

---

## 8. Sequence summary

```
prune docker  →  create db  →  tune  →  restore  →  verify counts
   →  detect-split-dates  →  build-adjusted-prices (MUST PASS)
   →  rebuild-derived-tables  →  enable crons + liveness alert
   →  kite-probe (DECIDES THE PLAN)  →  kite-instruments
   →  backfill-intraday  →  stop-loss test
```

Nothing after `kite-probe` should be built until the probe has been run — its
result determines whether historical backfill is even possible.
