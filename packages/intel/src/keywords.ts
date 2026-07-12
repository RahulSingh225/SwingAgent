/**
 * Comprehensive financial keyword dictionary.
 * Ported from MarketFeeds — used for client-side tagging & scoring.
 * Covers the full spectrum of market-moving events.
 *
 * All arrays are `as const` for type safety and zero runtime overhead.
 */

// ── Order & Contract Keywords ────────────────────────────

export const ORDER_KEYWORDS = [
  'order win',
  'order received',
  'order book',
  'new order',
  'repeat order',
  'order inflow',
  'order bagged',
  'secured order',
  'contract awarded',
  'contract win',
  'contract secured',
  'work order',
  'purchase order',
  'supply order',
  'turnkey order',
  'EPC order',
  'AMC contract',
  'rate contract',
] as const;

// ── LOI / PAL / Regulatory ───────────────────────────────

export const REGULATORY_KEYWORDS = [
  'letter of intent',
  'LoI',
  'LOI received',
  'PAL',
  'product approval',
  'ANDA approval',
  'USFDA approval',
  'DCGI approval',
  'CE marking',
  'BIS certification',
  'ISO certification',
  'regulatory approval',
  'patent granted',
  'patent filed',
  'license received',
  'FPO',
  'IPO',
  'OFS',
  'rights issue',
] as const;

// ── M&A / Corporate Actions ─────────────────────────────

export const CORPORATE_ACTION_KEYWORDS = [
  'acquisition',
  'merger',
  'amalgamation',
  'demerger',
  'buyback',
  'share buyback',
  'delisting',
  'bonus issue',
  'stock split',
  'dividend declared',
  'interim dividend',
  'final dividend',
  'special dividend',
  'rights issue',
  'preferential allotment',
  'QIP',
  'qualified institutional placement',
  'warrant conversion',
  'ESOP',
  'JV',
  'joint venture',
  'strategic partnership',
  'stake sale',
  'stake acquisition',
  'open offer',
  'takeover',
  'scheme of arrangement',
  'subsidiary',
  'wholly owned subsidiary',
  'divestment',
  'disinvestment',
] as const;

// ── Financial Results ────────────────────────────────────

export const RESULTS_KEYWORDS = [
  'quarterly results',
  'Q1 results',
  'Q2 results',
  'Q3 results',
  'Q4 results',
  'annual results',
  'revenue growth',
  'profit growth',
  'EBITDA',
  'PAT',
  'net profit',
  'operating profit',
  'revenue',
  'turnover',
  'topline',
  'bottomline',
  'EPS',
  'earnings per share',
  'margin expansion',
  'margin contraction',
  'guidance',
  'outlook',
  'forward guidance',
  'management commentary',
  'analyst meet',
  'investor presentation',
  'con call',
  'conference call',
  'board meeting',
  'AGM',
  'EGM',
] as const;

// ── Market Sentiment / Trading ───────────────────────────

export const SENTIMENT_KEYWORDS = [
  'block deal',
  'bulk deal',
  'insider trading',
  'promoter buying',
  'promoter selling',
  'promoter pledge',
  'pledge reduction',
  'FII buying',
  'DII buying',
  'short covering',
  'open interest',
  'delivery percentage',
  'volume spike',
  'upper circuit',
  'lower circuit',
  'breakout',
  'multibagger',
  '52 week high',
  '52 week low',
  'all time high',
  'market cap milestone',
  'blue chip',
  'penny stock',
  'momentum',
  'bull run',
  'bear trap',
  'dead cat bounce',
] as const;

// ── Sector-Specific: Defense ────────────────────────────

export const DEFENSE_KEYWORDS = [
  'defense order',
  'defence order',
  'military contract',
  'MoD',
  'Ministry of Defence',
  'BEL',
  'HAL',
  'DRDO',
  'Make in India defense',
  'Atmanirbhar Bharat',
  'naval order',
  'ammunition',
  'missile',
  'radar',
  'electronic warfare',
  'L1 bidder',
  'RFP',
  'RFQ',
  'ToT',
  'transfer of technology',
] as const;

// ── Sector-Specific: Telecom ────────────────────────────

export const TELECOM_KEYWORDS = [
  'spectrum allocation',
  '5G rollout',
  '5G order',
  'fiber optic',
  'FTTH',
  'BharatNet',
  'tower company',
  'network expansion',
  'subscriber addition',
  'ARPU',
  'data consumption',
  'telecom infra',
  'optical fiber',
  'OFC',
] as const;

// ── Sector-Specific: Infrastructure ─────────────────────

export const INFRA_KEYWORDS = [
  'highway project',
  'NHAI',
  'road construction',
  'smart city',
  'metro project',
  'railway order',
  'solar project',
  'wind energy',
  'renewable energy',
  'power plant',
  'transmission line',
  'water treatment',
  'real estate',
  'housing project',
  'RERA',
  'cement dispatch',
  'steel production',
] as const;

// ── Sector-Specific: Pharma & Healthcare ────────────────

export const PHARMA_KEYWORDS = [
  'ANDA filing',
  'USFDA',
  'FDA inspection',
  'clinical trial',
  'drug launch',
  'API',
  'formulation',
  'CRAMS',
  'CDMO',
  'biosimilar',
  'generic launch',
  'hospital chain',
  'diagnostic',
  'medical device',
] as const;

// ── Sector-Specific: IT & Technology ────────────────────

export const IT_KEYWORDS = [
  'deal win',
  'total contract value',
  'TCV',
  'digital transformation',
  'cloud migration',
  'AI contract',
  'cybersecurity',
  'SaaS',
  'platform deal',
  'client addition',
  'large deal',
  'mega deal',
  'attrition rate',
  'bench strength',
  'offshoring',
] as const;

// ── Sector-Specific: Banking & Finance ──────────────────

export const BFSI_KEYWORDS = [
  'NPA',
  'GNPA',
  'NNPA',
  'NIM',
  'net interest margin',
  'credit growth',
  'deposit growth',
  'CASA ratio',
  'provision coverage',
  'capital adequacy',
  'RBI',
  'rate cut',
  'monetary policy',
  'lending rate',
  'AUM',
  'assets under management',
  'NAV',
  'mutual fund',
  'insurance premium',
  'GWP',
] as const;

// ── Aggregated ──────────────────────────────────────────

export const ALL_KEYWORDS = [
  ...ORDER_KEYWORDS,
  ...REGULATORY_KEYWORDS,
  ...CORPORATE_ACTION_KEYWORDS,
  ...RESULTS_KEYWORDS,
  ...SENTIMENT_KEYWORDS,
  ...DEFENSE_KEYWORDS,
  ...TELECOM_KEYWORDS,
  ...INFRA_KEYWORDS,
  ...PHARMA_KEYWORDS,
  ...IT_KEYWORDS,
  ...BFSI_KEYWORDS,
] as const;

/** Map of keyword category to its keywords, for filtering/tagging */
export const KEYWORD_CATEGORIES: Record<string, readonly string[]> = {
  'Order & Contract': ORDER_KEYWORDS,
  'Regulatory & Approvals': REGULATORY_KEYWORDS,
  'Corporate Actions': CORPORATE_ACTION_KEYWORDS,
  'Financial Results': RESULTS_KEYWORDS,
  'Market Sentiment': SENTIMENT_KEYWORDS,
  Defense: DEFENSE_KEYWORDS,
  Telecom: TELECOM_KEYWORDS,
  Infrastructure: INFRA_KEYWORDS,
  'Pharma & Healthcare': PHARMA_KEYWORDS,
  'IT & Technology': IT_KEYWORDS,
  'Banking & Finance': BFSI_KEYWORDS,
};

/** Sector list for UI filter chips */
export const SECTORS = [
  'Defense',
  'Telecom',
  'IT & Technology',
  'Pharma & Healthcare',
  'Banking & Finance',
  'Infrastructure',
  'Order & Contract',
  'Corporate Actions',
  'Financial Results',
  'Market Sentiment',
  'Regulatory & Approvals',
] as const;

export type Sector = (typeof SECTORS)[number];
