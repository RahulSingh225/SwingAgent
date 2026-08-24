#!/usr/bin/env bash
#
# Daily intraday capture — run after market close on trading days.
#
# WHY THIS EXISTS
# Yahoo serves only 60 days of 5-minute history, and it ages out irreversibly.
# Bars not captured inside that window cannot be bought back from any vendor at
# any price. Each run converts a rolling 60-day window into permanent archive.
# Skipping a week costs a week that never comes back.
#
# Design notes:
#  - flock prevents overlapping runs if one is slow or the box is busy.
#  - A 5-day fetch window (not 1) self-heals: a missed day or two is picked up by
#    the next successful run without manual intervention.
#  - --refresh is REQUIRED. Without it every ticker is already checkpointed 'done'
#    from the initial backfill and the job silently does nothing.
#  - Non-zero exit on failure so cron/systemd surfaces it. The recurring failure
#    in this project has been pipelines that stopped without anyone noticing.
#
# Install: see docs/migration-runbook.md
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/marketos/apps/web}"
LOG_DIR="${LOG_DIR:-/var/log/marketos}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
LOCK_FILE="/tmp/marketos-intraday.lock"

# Python interpreter. Ubuntu 24.04 / Debian 12 mark the system Python as
# externally managed (PEP 668), so dependencies live in a venv rather than
# being pip-installed system-wide — which matters here because this box also
# runs another application and must not have its system Python mutated.
# Order: explicit $PY  ->  project venv  ->  system python3 (dev/macOS).
VENV_PY="${VENV_PY:-/opt/marketos/venv/bin/python3}"
if [ -n "${PY:-}" ]; then
  :                       # caller knows best
elif [ -x "$VENV_PY" ]; then
  PY="$VENV_PY"
else
  PY="python3"
fi

mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/intraday-$(date +%Y-%m-%d).log"

# Portable timestamp: `date -Is` is GNU-only and fails on BSD/macOS.
ts() { date "+%Y-%m-%dT%H:%M:%S%z"; }

# Locking. Critically, a MISSING flock must not look like "already locked" —
# flock returns 127 when absent, which would make this exit 0 and silently do
# nothing, the precise failure this job exists to avoid.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "$(ts) another capture is still running; skipping" >>"$LOG"
    exit 0
  fi
else
  echo "$(ts) WARNING: flock unavailable; running without a lock" >>"$LOG"
fi

# DATABASE_URL comes from the app's .env; never bake credentials into this file.
if [ -f "$ENV_FILE" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
  export DATABASE_URL
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "$(ts) FATAL: DATABASE_URL not set (looked in $ENV_FILE)" >>"$LOG"
  exit 1
fi

cd "$APP_DIR" || { echo "$(ts) FATAL: cannot cd $APP_DIR" >>"$LOG"; exit 1; }

# Fail loudly and immediately on a broken interpreter or missing deps. Under cron
# these surface as a job that "ran" and captured nothing, which is the failure
# mode this whole pipeline is built to avoid.
if ! "$PY" -c 'import yfinance, pandas, psycopg2' >/dev/null 2>&1; then
  echo "$(ts) FATAL: $PY is missing yfinance/pandas/psycopg2." >>"$LOG"
  echo "$(ts)        Create the venv:  python3 -m venv /opt/marketos/venv" >>"$LOG"
  echo "$(ts)        Then:             /opt/marketos/venv/bin/pip install yfinance pandas psycopg2-binary" >>"$LOG"
  exit 1
fi
echo "$(ts) using interpreter: $PY" >>"$LOG"

run_capture() {
  local interval="$1" period="$2"
  echo "$(ts) === ${interval} (period=${period}) ===" >>"$LOG"
  if $PY scripts/fetch-intraday-yf.py \
        --interval "$interval" --period "$period" \
        --min-turnover-cr 100 --batch 40 --refresh >>"$LOG" 2>&1; then
    return 0
  fi
  echo "$(ts) ERROR: ${interval} capture failed" >>"$LOG"
  return 1
}

rc=0
# 5-minute is the one that decays out of existence — run it first so a later
# failure never costs the irreplaceable data.
run_capture 5m  5d || rc=1
# 60-minute has 2 years of depth and is not urgent, but keeping it current is free.
run_capture 60m 5d || rc=1

# Log where coverage now ends; a stalled pipeline shows up here first.
$PY - <<'PYEOF' >>"$LOG" 2>&1 || true
import os, psycopg2
c = psycopg2.connect(os.environ['DATABASE_URL']); cur = c.cursor()
cur.execute("""SELECT interval, count(*), max((ts AT TIME ZONE 'Asia/Kolkata')::date)
               FROM intraday_bars GROUP BY 1 ORDER BY 1""")
for iv, n, last in cur.fetchall():
    print(f"  coverage {iv}: {n} bars, through {last}")
c.close()
PYEOF

# Keep 30 days of logs.
find "$LOG_DIR" -name 'intraday-*.log' -mtime +30 -delete 2>/dev/null

echo "$(ts) done rc=$rc" >>"$LOG"
exit $rc
