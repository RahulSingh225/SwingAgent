# Market OS — Swing Trading Ecosystem — Implementation Plan

A pnpm monorepo unifying **AlertsReader** (React Native, existing) with a fresh **Next.js analysis app**. The server owns ingestion, scoring, EOD analytics, and the nightly candidates screen; the mobile app becomes a thin client for the same data. Objective for v1: **swing trading only** — evening analysis, GTT orders placed manually, zero market-hours attention required.

## User Review Required

> [!IMPORTANT]
> **Security remediation — status (2026-07-12)**
> 1. ✅ **Resolved**: AlertsReader repo made private, Ollama EC2 terminated. Hardcoded endpoint stripped from `types.ts` (Ollama config now comes from the Settings screen only, disabled by default).
> 2. ✅ Hardcoded `DEFAULT_RSS_URLS` stripped from the app — feed URLs are entered via the Add Feed screen (local MMKV storage). Existing alert URLs are kept as-is (owner's decision — no regeneration).

> [!IMPORTANT]
> **Database hosting**: local Postgres 16 via Docker for dev. For the always-on production pipeline, confirm: Supabase free tier, Neon, or a small VPS running the compose stack. (VPS recommended — crons and DB co-located, ~₹400–800/mo.)

> [!WARNING]
> **Explicitly out of scope for v1 (parking lot, see bottom)**: automated signal generation, backtesting engine, X API, broker API integration (Kite Connect / Groww API), auth beyond basic-auth, PWA. v1 outputs **candidates**, never **signals**.

## Decisions

- **Notifications: Telegram** for v1 (bot + chat ID, ~30 min setup). FCM push to AlertsReader deferred to Phase 6.
- **Alert feeds are dual-homed**: the same Google Alerts URLs live in the server's `feed_sources` (primary ingestion) *and* in AlertsReader's local settings — the app keeps its on-device RSS + intel pipeline as an offline/standalone mode, so alerts stay viewable even when the Next.js server is down. (This is the Phase 6 "Server mode vs Standalone mode" toggle; the standalone path already works today.)
- **AI provider: Gemini API everywhere** (Google AI Studio key, `gemini-2.5-flash` default). ✅ AlertsReader's `ollamaService` replaced with `geminiService` (API key in Settings); server-side enrichment (Phase 2) uses the same `buildAnalysisPrompt`/`parseAIAnalysisResponse` from `@market-os/intel`.

## Open Questions

1. **Setup A definition** — the one mechanical swing screen for v1. Placeholder below (trend + volume + proximity to high). To be replaced by the rules you extract from your YouTube transcript exercise. Confirm before Phase 4.
2. **Sector taxonomy** — use NSE's sectoral indices as the canonical sector list, or your own keyword-derived sectors from `packages/intel`? Recommend NSE indices for the heatmap (official constituents) + keyword tags for events.

---

## Monorepo Layout

```
market-os/
├── package.json               # pnpm workspaces + turborepo
├── turbo.json
├── docker-compose.yml         # postgres:16, redis:7 (BullMQ)
├── packages/
│   └── intel/                 # THE shared brain — plain TS, zero framework deps
│       ├── src/
│       │   ├── types.ts       # MarketEvent, ExtractionResult, ScoreResult
│       │   ├── keywords.ts    # lifted from AlertsReader src/intelligence/keywords.ts
│       │   ├── extractor.ts   # lifted from AlertsReader src/intelligence/extractor.ts
│       │   ├── scorer.ts      # lifted from AlertsReader src/intelligence/scorer.ts
│       │   ├── dedup.ts       # lifted from AlertsReader src/intelligence/dedup.ts
│       │   └── prompts.ts     # AI analysis prompt (ported from ollamaService buildPrompt)
│       └── package.json       # name: @market-os/intel
├── apps/
│   ├── web/                   # fresh Next.js 15 (App Router) — this plan
│   └── mobile/                # AlertsReader moved in as-is (Phase 6 refactor)
```

### The Integration Contract — `MarketEvent`

Single normalized type in `packages/intel/src/types.ts`, derived from AlertsReader's `FeedItem` + `ExtractionResult` (kept field-compatible so the mobile refactor is mechanical):

```ts
export interface MarketEvent {
  id: string;                    // sha256(normalized title + link)
  source: 'google_alerts' | 'nse' | 'bse' | 'rss';
  title: string;
  link: string;
  snippet: string;
  publishedAt: string;           // ISO
  // extraction (from @market-os/intel extractor)
  ticker?: string;
  companyName?: string;
  sector?: string;
  sectorTags: string[];
  matchedKeywords: string[];
  orderValue?: number;
  orderValueUnit?: 'Cr' | 'Lakh' | 'Bn' | 'Mn';
  contractType?: string;
  // scoring
  impactScore: number;           // 1–10 rule-based (scorer.ts)
  scoreDetails: ClientScoreResult;
  // AI (async enrichment)
  aiAnalysis?: AIAnalysis;       // same shape as AlertsReader's AIAnalysis
}
```

Rule: **only `packages/intel` produces this type.** Web ingests raw feeds → intel → `MarketEvent` → Postgres. Mobile (Phase 6) fetches `MarketEvent[]` from `/api/feed`.

---

## Phase 0: Extraction & Security (½ evening) — ✅ DONE 2026-07-12

- [NEW] `packages/intel` — copy `keywords.ts`, `extractor.ts`, `scorer.ts`, `dedup.ts` from AlertsReader unchanged; add `types.ts` (`MarketEvent`), `prompts.ts` (port `buildPrompt` from `ollamaService.ts`, return-format unchanged so `AIAnalysis` parsing carries over).
- [MODIFY] AlertsReader — `src/intelligence/*` re-exports from `@market-os/intel` (no behavior change yet); strip Ollama IP + alert URLs from `types.ts`, read from settings screen only.
- EC2: firewall 11434; plan its decommission at end of Phase 3.

## Phase 1: Web Foundation (weekend 1, part 1) — ✅ DONE 2026-07-12

- [NEW] `apps/web` — Next.js 15, Drizzle + `postgres`, Tailwind. `serverExternalPackages: ['postgres','bullmq','ioredis']`.
- [NEW] `lib/db/schema.ts`:

| Table | Key columns | Purpose |
|---|---|---|
| `companies` | ticker (PK), name, sector, nse_index_memberships text[], market_cap_category | seeded from NSE equity list CSV |
| `events` | id (content hash, unique), all `MarketEvent` fields, ai_analysis JSONB | catalyst feed |
| `eod_prices` | ticker, date, o/h/l/c, volume, delivery_pct — PK (ticker, date) | bhavcopy |
| `indicators` | ticker, date, ema20, ema50, ema200, avg_vol_20, atr14, pct_from_52w_high, rsi14 | computed nightly |
| `sector_snapshot` | index_name, date, pct_change, advance, decline | heatmap + breadth |
| `fii_dii` | date, fii_buy, fii_sell, dii_buy, dii_sell (₹ Cr) | port fii-dii-data scraper |
| `candidates` | date, ticker, setup_name, screen_values JSONB, catalyst_event_id FK nullable | nightly screen output |
| `trades` | id, ticker, direction, entry, stop, target, qty, thesis, catalyst_event_id, opened_at, closed_at, exit_price, r_multiple | journal |
| `briefs` | date (PK), content_md, model, generated_at | AI evening brief |
| `feed_sources` | id, type, url, label, enabled, poll_interval_min, last_polled_at | your regenerated alert feeds live here |

- Indexes: `events(published_at)`, `events(impact_score)`, `events(ticker)`, GIN on `sector_tags`.
- [NEW] `instrumentation.ts` — start node-cron + BullMQ workers on boot (Node runtime).

## Phase 2: Ingestion (weekend 1, part 2)

All jobs: cron → BullMQ → pipeline (`dedup → extract → score → store`), reusing MarketFeeds patterns.

- [NEW] `lib/ingestion/google-alerts.ts` — rss-parser over `feed_sources`; every 15 min.
- [NEW] `lib/ingestion/nse-announcements.ts` / `bse-announcements.ts` — port from MarketFeeds; every 15 min, 08:00–19:00 IST only (no need for tighter — you trade in the evening).
- [NEW] `lib/ingestion/bhavcopy.ts` — 18:45 IST daily: download NSE bhavcopy (UDiFF CSV) + BSE equivalent, upsert `eod_prices`; then compute `indicators` for all tickers (pure SQL/TS, no libs needed beyond a small EMA/ATR/RSI module with unit tests); then `sector_snapshot` from index data + advance/decline.
- [NEW] `lib/ingestion/fii-dii.ts` — port your fii-dii-data scraper; 19:30 IST.
- [NEW] `lib/ai/gemini.ts` — replaces Ollama. Batch: after each ingestion run, send events with `impactScore >= 6` and no `aiAnalysis` to Gemini using `prompts.ts`; store `AIAnalysis`. Rate-limit to free tier.
- [NEW] `lib/notify/telegram.ts` — push events with `impactScore >= 7` (dedup-aware) + the nightly digest.

## Phase 3: Dashboard (weekend 2)

Single screen, `app/page.tsx` — the decision surface:

- [NEW] `components/TopStrip.tsx` — Nifty/BankNifty/Midcap150 %, advance/decline, FII & DII net. Five numbers, three seconds.
- [NEW] `components/SectorHeatmap.tsx` — Recharts Treemap of NSE sectoral indices (size = index weight proxy, color = % change), click → drill to constituents from `eod_prices`.
- [NEW] `components/EventRail.tsx` — right rail; `events` where score ≥ 6, newest first, AI summary inline, link out.
- [NEW] `components/CandidatesTable.tsx` — the bottom table: today's `candidates` joined with any catalyst event; columns: ticker, setup, close vs EMAs, vol ratio, % from 52w high, catalyst (if any), "Journal it" button.
- [NEW] `app/journal/page.tsx` + trade entry form with **position-size calculator built in**: inputs capital-at-risk % and stop distance → outputs qty. Cap on open trades surfaced in the UI.
- [NEW] API routes: `/api/feed`, `/api/candidates`, `/api/trades` (CRUD), `/api/brief/latest` — these are also the mobile contract.
- Basic-auth middleware on everything (single user).

## Phase 4: Screener — "candidates, not signals" (weekend 3, part 1)

- **Offline first**: run the transcript exercise — `youtube-transcript-api` → Gemini/Claude prompt: *"Extract every concrete, testable rule stated: entry, exit, stop, timeframe, filters. Flag anything vague or discretionary."* → review → pick ONE mechanical setup. Output: `docs/setups/setup-a.md`.
- [NEW] `lib/screener/setup-a.ts` — placeholder until then:
  - close > ema50 AND ema20 > ema50 (trend)
  - volume > 1.5 × avg_vol_20 (participation)
  - pct_from_52w_high ≥ −5% (proximity to breakout)
  - liquidity floor: 20-day avg turnover > ₹5 Cr
- Runs at 19:45 IST after indicators; writes `candidates`; flags rows whose ticker had an event (score ≥ 6) in the last 5 sessions — **those float to the top**.
- Every screener version is named and stored in `screen_values` so the journal can attribute outcomes to setup versions.

## Phase 5: Evening Brief + Digest (weekend 3, part 2)

- [NEW] `lib/ai/brief.ts` — 20:00 IST: hand Gemini the day's `sector_snapshot`, breadth, `fii_dii`, top 10 events, and candidates list → 10-line structured markdown brief → `briefs` + Telegram.
- Telegram nightly digest: brief + candidates table rendered as text.

## Phase 6: Mobile Becomes a Client (later, non-blocking)

- [MODIFY] AlertsReader — new `apiService.ts`: fetch `/api/feed`, `/api/candidates`, `/api/brief/latest`; keep on-device RSS+intel path as **offline fallback mode** (it already works — don't delete it).
- Settings toggle: "Server mode" (URL + token) vs "Standalone mode".
- FCM push replaces/augments Telegram if desired.

---

## The Routine (what all of this serves)

| When | Duration | What |
|---|---|---|
| 20:00–20:30 | 30 min | Read brief → heatmap for rotation → candidates table → pick 0–2 → write one-line thesis in journal **before** placing GTT orders (entry + stop + target) on Zerodha/Groww. No thesis, no trade. |
| 09:00–09:10 | 10 min | Global cues + gaps vs pending orders. Adjust or cancel; never add in the morning. |
| Lunch | 2 min | Telegram glance only. |
| Weekend | 60–90 min | Journal: win rate + R-multiple per setup version. Pipeline audit: what the scorer surfaced that you ignored; what moved that it missed. Feed findings back into keywords/weights and the screener. |

## Execution Order

1. Phase 0 security + package extraction (do the firewall rule **today**)
2. Phase 1 → 2 (weekend 1): schema, bhavcopy + alerts ingestion, Gemini enrichment — verify indicators against a charting site for 5 tickers
3. Phase 3 (weekend 2): dashboard, ship ugly
4. Phase 4 → 5 (weekend 3): screener + brief + Telegram
5. Use daily for 4 weeks before touching Phase 6 or the parking lot

## Verification Plan

```bash
pnpm turbo build                      # whole workspace compiles
npx drizzle-kit push && npx drizzle-kit studio
pnpm --filter @market-os/intel test   # unit tests: extractor, scorer, EMA/ATR/RSI vs known values
curl -u user:pass localhost:3000/api/candidates?date=today
```

- Ingest the same alert feed twice → dedup holds (0 new rows second run).
- Bhavcopy indicators for RELIANCE/HDFCBANK/a smallcap vs TradingView values (±0.5%).
- Screener dry-run on 30 days of stored bhavcopy → eyeball candidates for sanity.
- Kill the phone for 48h → server pipeline unaffected (the whole point).

## Parking Lot (v2, gated on journal evidence)

- Signal engine: promote Setup A to "signal" only after 2–3 months of journal data shows an edge
- Backtester over multi-year bhavcopy history
- Broker read-API integration (Kite Connect personal / Groww API — verify current terms) for auto-journaling fills & P&L
- X API ingestion, multi-setup screeners, auth/multi-user
