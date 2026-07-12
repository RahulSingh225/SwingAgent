/**
 * Shared types for @market-os/intel.
 *
 * `ExtractionResult` and `AIAnalysis` are kept field-compatible with
 * AlertsReader's `src/types/index.ts` so the mobile refactor stays mechanical.
 * `MarketEvent` is the single normalized event type — only this package
 * produces it (web ingests raw feeds → intel → MarketEvent → Postgres;
 * mobile fetches MarketEvent[] from /api/feed).
 */

// ── Extraction ───────────────────────────────────────────

export interface ExtractionResult {
  ticker?: string;
  companyName?: string;
  sector?: string;
  sectorTags: string[];
  orderValue?: number;
  orderValueUnit?: string;
  contractType?: string;
  matchedKeywords: string[];
}

export type OrderValueUnit = 'Cr' | 'Lakh' | 'Bn' | 'Mn';

// ── Scoring ──────────────────────────────────────────────

export interface ClientScoreResult {
  totalScore: number; // 1-10
  keywordScore: number;
  sectorScore: number;
  recencyScore: number;
  orderValueScore: number;
}

// ── AI Analysis ──────────────────────────────────────────

/** Structured AI analysis result from the LLM (Ollama/Gemini agnostic). */
export interface AIAnalysis {
  /** AI-assessed impact score 1–10 */
  aiScore: number;
  /** 2-3 line trader's take / actionable summary */
  summary: string;
  /** Market sentiment assessment */
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  /** AI confidence in its assessment */
  confidence: 'High' | 'Medium' | 'Low';
  /** Predicted price action */
  pricePrediction: string;
  /** Who awarded the contract/order */
  counterparty?: string;
  /** New / Repeat / Follow-on */
  orderType?: string;
  /** Estimated revenue impact */
  revenueImpact?: string;
  /** Most important takeaway */
  keyInsight?: string;
  /** Potential risks to watch */
  riskFactors?: string;
  /** When this analysis was generated */
  analyzedAt: string;
}

// ── The Integration Contract ─────────────────────────────

export type MarketEventSource = 'google_alerts' | 'nse' | 'bse' | 'rss';

export interface MarketEvent {
  /** Content hash of normalized title + link */
  id: string;
  source: MarketEventSource;
  title: string;
  link: string;
  snippet: string;
  /** ISO timestamp */
  publishedAt: string;
  // extraction (from extractor.ts)
  ticker?: string;
  companyName?: string;
  sector?: string;
  sectorTags: string[];
  matchedKeywords: string[];
  orderValue?: number;
  orderValueUnit?: OrderValueUnit;
  contractType?: string;
  // scoring (from scorer.ts)
  /** Rule-based impact score 1–10 */
  impactScore: number;
  scoreDetails: ClientScoreResult;
  // AI (async enrichment)
  aiAnalysis?: AIAnalysis;
}
