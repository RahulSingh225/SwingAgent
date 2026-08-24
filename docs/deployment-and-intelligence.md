# Deployment, Hardware & System Intelligence — Assessment

**Date:** 2026-08-04
**Predecessors:** [gap-fade-findings.md](gap-fade-findings.md),
[wave-fade-findings.md](wave-fade-findings.md), [ledger-findings.md](ledger-findings.md),
[outcome-ledger.md](outcome-ledger.md)

---

## 1. Two corrections before planning

**The database is 5.9 GB, not 25 GB.**

| Consumer | Size | Reclaimable |
|---|---|---|
| Docker build cache | 20.9 GB | **100%** |
| Docker images | 20.1 GB | 19.2 GB (95%) |
| **Postgres data** | **5.9 GB** | — |

`docker system prune -a --volumes` frees ~40 GB. There is no local storage problem.

**Intraday needs ~700 tickers, not 3,234.** Only **696** names carry ≥₹100cr
turnover — the tradeable universe. Scoping intraday ingestion to liquid names
changes the storage problem from prohibitive to routine:

| Granularity | Tickers | Rows (7 yrs) | Est. size with indexes |
|---|---|---|---|
| 5-min | 700 | ~93 M | **8–12 GB** |
| 1-min | 700 | ~465 M | 40–60 GB |
| 1-min | 3,234 | ~2.1 B | 200–300 GB (avoid) |

**5-minute bars for the liquid universe is the right first target.** It fits
comfortably, and it is enough to test stops, opening-range rules and time-based
exits — the three things daily bars cannot answer.

---

## 2. Hardware verdict: the GPU will not help, and the instance is wrong-shaped

**g4dn.xlarge** = 4 vCPU, 16 GB RAM, 1× NVIDIA T4 (16 GB), 125 GB NVMe,
≈ $380/month running 24/7.

### The GPU is close to useless for this workload

Everything this system does is **Postgres queries, ingestion and statistics** —
CPU and I/O bound. A T4 would sit idle.

The instinct is "GPU → machine learning → better signals". That instinct is wrong
here, and this project is the evidence:

- 3.2 M daily bars is a *tiny* dataset by ML standards.
- **Four separate apparent edges in this project died under out-of-sample testing.**
  A neural network on the same data would find far more spurious structure, far
  more convincingly, and fail the same way — just less legibly.
- The binding constraint has never been model capacity. It has been **data
  availability and statistical discipline.**

Adding a GPU-trained model now would increase the rate of false discoveries, not
reduce it.

### Two specific problems with this instance

1. **125 GB NVMe is ephemeral instance storage.** It is wiped on stop/start. The
   database *must* live on EBS (gp3), or you will lose everything on the first
   restart. This is the single most important operational detail here.
2. **16 GB RAM is tight** once intraday lands. Postgres wants `shared_buffers`
   ≈ 25% of RAM and room for sorts; a 20 GB intraday table on 16 GB RAM means
   most queries hit disk.

### Recommendation

| Option | Spec | ~Cost/mo | Verdict |
|---|---|---|---|
| Keep g4dn.xlarge | 4 vCPU / 16 GB / T4 | ~$380 | Paying ~$300 for an idle GPU |
| **m6i.large + 200GB gp3** | 2 vCPU / 8 GB | **~$85** | Fine for ingestion + cron |
| **m6i.xlarge + 300GB gp3** | 4 vCPU / 16 GB | **~$160** | **Recommended** — same CPU/RAM, no GPU tax, proper storage |
| r6i.xlarge + gp3 | 4 vCPU / 32 GB | ~$230 | If intraday queries feel slow |

**If the g4dn is already paid for or reserved, use it** — just put the data on EBS
and accept the GPU is decoration. Do not buy GPU capacity for this.

### Where the T4 *could* genuinely earn its keep

Narrow but real:

1. **A local LLM for document extraction.** We processed 7,325 PDFs; a 7B model on
   the T4 would handle classification and extraction at zero marginal API cost. This
   is the one workload that genuinely fits.
2. **Whisper/OCR** for the ~7.6% of announcement PDFs that are scans with no text
   layer — currently unrecoverable.

Neither generates alpha. Both reduce cost and fill data gaps.

---

## 3. What the server is actually for

Not compute. **Continuity.** Three things a laptop cannot do:

1. **Unattended ingestion at fixed times** — bhavcopy 18:45 IST, announcements
   every 15 min, intraday capture during market hours. This is the real reason to
   deploy.
2. **Forward intraday capture.** Most Indian broker APIs limit historical 1-minute
   lookback (verify current terms — Kite Connect, Upstox, Angel One all differ).
   If deep history is unavailable, **the only way to get it is to start recording
   now**, which requires an always-on box. Every day of delay is a day of data you
   cannot retroactively buy.
3. **Paper-trade logging at the open**, without you being at a laptop.

---

## 4. Migration sequence

Ordered so nothing blocks on anything later.

**Phase 1 — Stand up (half a day)**
- EBS gp3 volume, 300 GB, mounted for Postgres. **Not** the NVMe instance store.
- `docker compose up postgres`; tune `shared_buffers=4GB`, `work_mem=64MB`,
  `maintenance_work_mem=1GB`, `effective_cache_size=12GB`.
- `pg_dump` local → restore on server. 5.9 GB, minutes not hours.
- Drop the derived helper tables before dumping (`_sessions`, `_sessions_o`,
  `_volratio`, `_turnover`, `_typed_events`) — ~1.5 GB that rebuilds from scripts.
- Basic-auth or Tailscale. Never expose Postgres to the internet.

**Phase 2 — Restore the cron pipeline (half a day)**
- `ENABLE_JOBS=true`; verify the existing schedule fires (18:45 bhavcopy, etc.).
- Add a daily reconciliation check: row counts moved, no failed windows.
- Alert on *silence*, not just errors — a pipeline that stops is the failure mode
  that cost this project a month before.

**Phase 3 — Intraday ingestion (the real work)**
- Pick a provider, verify historical lookback **before** building.
- Target: 5-min bars, ~700 liquid tickers.
- Backfill whatever history is purchasable; **start forward capture immediately**
  regardless, because forward data cannot be bought later.
- Same conventions as everything else: split-adjusted, benchmark-relative,
  cost-netted, resumable checkpoints.

**Phase 4 — What intraday unlocks (in priority order)**
1. **Stop-loss testing.** [gap-fade-findings.md](gap-fade-findings.md) shows the
   gap fade is only viable with a stop (mean +0.36%, worst −51.9%), and daily bars
   cannot test one. This is the highest-value question in the system.
2. **Fill-quality validation** — does the opening-auction price match what you'd get?
3. Opening-range and first-30/60/90-minute rules from the original brief.
4. Time-based exits instead of holding to close.

---

## 5. Gemini's real role

Proven useful, and proven useless, in specific ways.

**Where it works** (demonstrated in this project):
- Document extraction — order values from PDFs reached ~88% precision after three
  hand-audit iterations. Real value.
- Code generation, summarisation, the daily brief.
- Classification of unstructured text into a fixed taxonomy.

**Where it does not work, and should not be used:**
- **Generating trading hypotheses or signals.** An LLM asked "what edge exists in
  this data?" will produce fluent, plausible, untested answers — precisely the
  failure mode this project spent weeks defending against. It has no way to know
  that the catalyst-filter edge was 1.68pp in-sample and 0.10pp out-of-sample.
- **Judging whether a result is real.** That is what controls and train/test splits
  are for.

**Rule: Gemini reads and writes; statistics decides.**

---

## 6. "Constantly evolving without supervision" — the hard part

This is the most dangerous idea in the brief, and it deserves a direct answer.

### Why unsupervised self-improvement fails here

A system that automatically searches for edges **will find them**. It will find
them every single week, and almost all will be false.

The evidence is this project's own history. Four apparent edges — the catalyst
filter, the large-order short, the volume-climax fade, the wave-fade extension
cell — looked genuine in-sample and were killed by controls and train/test splits.
An unsupervised searcher would have shipped all four.

The rate is not incidental. At ~50 cells examined per study, chance alone produces
several "significant" results. Automating the search **multiplies** that rate;
automating the search without automating the skepticism is a machine for
generating confident nonsense.

### What can safely be automated

Automate the **validation harness**, never the discovery.

| Automate | Never automate |
|---|---|
| Data ingestion + integrity checks | Choosing which hypothesis to test |
| Running a **pre-registered** hypothesis on a fixed protocol | Deciding a result is "good enough" |
| Control group, train/test split, cost-netting | Changing thresholds to improve a result |
| **Decay monitoring on a live strategy** | Promoting a strategy to live |
| Reporting failures as loudly as successes | Position sizing changes |

Concretely:

1. **A hypothesis register.** A file of pre-specified, dated hypotheses with their
   exact rules, written *before* they are run. Anything not in the register cannot
   be reported as a finding. This is the single highest-value process change.
2. **A fixed protocol runner.** One command takes a hypothesis and emits: control
   baseline, in-sample, out-of-sample, cost sensitivity, tail statistics, and a
   pass/fail against pre-set thresholds. No judgement calls at runtime.
3. **Decay monitoring — the genuinely valuable automation.** If a strategy goes
   live, track its realised edge against the backtest expectation on a rolling
   basis, and alert when it degrades. This is *supervision of a known thing*, not
   discovery of an unknown one, and it is where continuous automation pays.
4. **A multiple-comparisons ledger.** Count every cell ever examined. Report it
   with every finding. When the count is in the hundreds, the bar for a new
   "discovery" must rise accordingly.

### The honest framing

The system should get better at **testing**, not at **guessing**. A pipeline that
runs one pre-registered hypothesis properly per month will outperform one that
runs a thousand unsupervised, because the second will act on noise and the first
will not.

---

## 7. How to know you are on the right track

Pre-committed criteria, so the answer is not decided after seeing the numbers.

### Kill criteria for the gap fade (the only live candidate)

Stop, and do not deploy capital, if **any** of these are true after ~50 paper trades:

- Mean slippage vs the assumed open exceeds **0.15%**. The edge is +0.36%; this
  removes most of it.
- More than 10% of intended shorts could not be executed (unavailable/locked).
- Realised win rate below **48%** (backtest: 55%).
- Any single trade loses more than **20%** without a stop being testable.

### Green-light criteria

Proceed to small live capital only when **all** hold:

- ≥50 paper trades logged with honest fills, including failures to execute.
- Mean slippage < 0.10%.
- Realised mean within one standard error of +0.36%.
- Intraday data acquired and a stop-loss rule tested, with the strategy still
  positive after the stop.
- Position sizing set so the worst historical trade (−51.9%) costs ≤1% of capital.

### Process metrics to track continuously

Not P&L — process:

- Cells examined per finding reported (the multiple-comparisons count).
- Fraction of hypotheses that were pre-registered before testing.
- Days of unbroken ingestion (a stopped pipeline is the recurring failure here).
- Time from signal to logged fill.
- Number of "no trade today" days — a healthy system produces many.

### The single most important indicator

**Is the system still killing its own findings?**

This project's value has come from four apparent edges being correctly rejected.
If months pass with no rejections and a stream of confirmations, the discipline
has quietly failed — not the market's behaviour.

---

## 8. Summary

- **Prune Docker** (~40 GB). There is no local storage problem; the DB is 5.9 GB.
- **The GPU will not help.** Deploy to a cheaper CPU instance, or use the g4dn but
  put data on **EBS, never the ephemeral NVMe**, and accept the T4 is idle.
- **Deploy for continuity, not compute** — unattended crons and, above all, forward
  intraday capture that cannot be bought retroactively.
- **Scope intraday to ~700 liquid tickers at 5-min** → 8–12 GB, entirely routine.
- **Gemini reads and writes; statistics decides.**
- **Automate validation, never discovery.** Pre-register hypotheses; count every
  comparison; monitor decay on live strategies.
- **The health metric is whether the system still rejects its own findings.**
