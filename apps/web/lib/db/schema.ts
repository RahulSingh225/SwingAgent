/**
 * Market OS database schema.
 *
 * `events` mirrors the `MarketEvent` contract from @market-os/intel —
 * only the ingestion pipeline (raw feed → intel → MarketEvent) writes it.
 */

import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { AIAnalysis, ClientScoreResult } from '@market-os/intel';

// ── Reference data ───────────────────────────────────────

/** Seeded from the NSE equity list CSV. */
export const companies = pgTable('companies', {
  ticker: text('ticker').primaryKey(),
  name: text('name').notNull(),
  sector: text('sector'),
  nseIndexMemberships: text('nse_index_memberships').array().notNull().default([]),
  marketCapCategory: text('market_cap_category'), // large | mid | small | micro
});

// ── Catalyst feed ────────────────────────────────────────

/** One row per deduplicated MarketEvent (id = content hash). */
export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(), // google_alerts | nse | bse | rss
    title: text('title').notNull(),
    link: text('link').notNull(),
    snippet: text('snippet').notNull().default(''),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    // extraction
    ticker: text('ticker'),
    companyName: text('company_name'),
    sector: text('sector'),
    sectorTags: text('sector_tags').array().notNull().default([]),
    matchedKeywords: text('matched_keywords').array().notNull().default([]),
    orderValue: doublePrecision('order_value'),
    orderValueUnit: text('order_value_unit'), // Cr | Lakh | Bn | Mn
    contractType: text('contract_type'),
    // scoring
    impactScore: real('impact_score').notNull(),
    scoreDetails: jsonb('score_details').$type<ClientScoreResult>().notNull(),
    // AI enrichment (async, Gemini)
    aiAnalysis: jsonb('ai_analysis').$type<AIAnalysis>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [
    index('events_published_at_idx').on(t.publishedAt),
    index('events_impact_score_idx').on(t.impactScore),
    index('events_ticker_idx').on(t.ticker),
    index('events_sector_tags_gin').using('gin', t.sectorTags),
  ],
);

// ── EOD market data ──────────────────────────────────────

/** Daily bhavcopy (NSE UDiFF CSV + BSE equivalent). */
export const eodPrices = pgTable(
  'eod_prices',
  {
    ticker: text('ticker').notNull(),
    date: date('date').notNull(),
    open: doublePrecision('open').notNull(),
    high: doublePrecision('high').notNull(),
    low: doublePrecision('low').notNull(),
    close: doublePrecision('close').notNull(),
    volume: bigint('volume', { mode: 'number' }).notNull(),
    deliveryPct: real('delivery_pct'),
  },
  t => [primaryKey({ columns: [t.ticker, t.date] })],
);

/** Computed nightly after bhavcopy ingest. */
export const indicators = pgTable(
  'indicators',
  {
    ticker: text('ticker').notNull(),
    date: date('date').notNull(),
    ema20: doublePrecision('ema20'),
    ema50: doublePrecision('ema50'),
    ema200: doublePrecision('ema200'),
    avgVol20: doublePrecision('avg_vol_20'),
    atr14: doublePrecision('atr14'),
    pctFrom52wHigh: real('pct_from_52w_high'),
    rsi14: real('rsi14'),
    // Phase 4 — screener fields
    sma20: doublePrecision('sma20'),
    sma20Prev: doublePrecision('sma20_prev'),
    closePrev: doublePrecision('close_prev'),
    roc20: real('roc20'),
    rsi7: real('rsi7'),
    rsi7Prev: real('rsi7_prev'),
    stochK: real('stoch_k'),
    stochKPrev: real('stoch_k_prev'),
    weeklyTrend: text('weekly_trend'), // UP | DOWN | FLAT
  },
  t => [primaryKey({ columns: [t.ticker, t.date] })],
);

/** Sectoral index snapshot — heatmap + breadth. */
export const sectorSnapshot = pgTable(
  'sector_snapshot',
  {
    indexName: text('index_name').notNull(),
    date: date('date').notNull(),
    pctChange: real('pct_change').notNull(),
    advance: integer('advance'),
    decline: integer('decline'),
  },
  t => [primaryKey({ columns: [t.indexName, t.date] })],
);

/** FII/DII daily flows in ₹ Cr (ported fii-dii-data scraper). */
export const fiiDii = pgTable('fii_dii', {
  date: date('date').primaryKey(),
  fiiBuy: doublePrecision('fii_buy'),
  fiiSell: doublePrecision('fii_sell'),
  diiBuy: doublePrecision('dii_buy'),
  diiSell: doublePrecision('dii_sell'),
});

// ── Screener output ──────────────────────────────────────

/** Nightly screen output — candidates, never signals. */
export const candidates = pgTable(
  'candidates',
  {
    date: date('date').notNull(),
    ticker: text('ticker').notNull(),
    /** Versioned setup name, e.g. "setup-a@v1" — journal attributes outcomes to it. */
    setupName: text('setup_name').notNull(),
    screenValues: jsonb('screen_values').$type<Record<string, number | string>>().notNull(),
    catalystEventId: text('catalyst_event_id').references(() => events.id),
  },
  t => [
    primaryKey({ columns: [t.date, t.ticker, t.setupName] }),
    index('candidates_date_idx').on(t.date),
  ],
);

// ── Journal ──────────────────────────────────────────────

export const trades = pgTable('trades', {
  id: serial('id').primaryKey(),
  ticker: text('ticker').notNull(),
  direction: text('direction').notNull(), // long | short
  entry: doublePrecision('entry').notNull(),
  stop: doublePrecision('stop').notNull(),
  target: doublePrecision('target'),
  qty: integer('qty').notNull(),
  /** No thesis, no trade. */
  thesis: text('thesis').notNull(),
  setupName: text('setup_name'),
  catalystEventId: text('catalyst_event_id').references(() => events.id),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  exitPrice: doublePrecision('exit_price'),
  rMultiple: real('r_multiple'),
});

// ── AI evening brief ─────────────────────────────────────

export const briefs = pgTable('briefs', {
  date: date('date').primaryKey(),
  contentMd: text('content_md').notNull(),
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Feed sources ─────────────────────────────────────────

/** Polled feeds — Google Alerts URLs live here, not in code. */
export const feedSources = pgTable('feed_sources', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(), // google_alerts | nse | bse | rss
  url: text('url').notNull().unique(),
  label: text('label').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  pollIntervalMin: integer('poll_interval_min').notNull().default(15),
  lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
});
