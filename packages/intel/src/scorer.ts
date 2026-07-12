/**
 * Client-side rule-based impact scorer.
 * Ported from MarketFeeds — scores items 1–10 using:
 *   - Keyword density (high-impact keyword matches)
 *   - Sector relevance (trending sector boost)
 *   - Recency (how fresh the item is)
 *   - Order value (monetary significance)
 *
 * No AI component — keyword density fills the AI weight.
 * All operations are synchronous and lightweight.
 */

import type {ClientScoreResult, ExtractionResult} from './types';

// ── Pre-defined keyword sets (allocated once) ───────────

const HIGH_IMPACT_KEYWORDS = [
  'order win',
  'contract awarded',
  'acquisition',
  'merger',
  'buyback',
  'demerger',
  'delisting',
  'open offer',
  'takeover',
  'USFDA approval',
  'block deal',
  'bulk deal',
  'promoter buying',
  'quarterly results',
  'dividend',
];

const SECTOR_BOOST_KEYWORDS = [
  'defense',
  'defence',
  'military',
  'telecom',
  '5g',
  'semiconductor',
  'ev',
  'electric vehicle',
  'ai',
  'artificial intelligence',
  'green energy',
  'renewable',
  'hydrogen',
];

// ── Score Result ────────────────────────────────────────

// ClientScoreResult lives in types.ts (MarketEvent.scoreDetails references it);
// re-exported here to keep this module's public surface unchanged.
export type {ClientScoreResult} from './types';

// ── Main scoring function ───────────────────────────────

/**
 * Calculate a rule-based impact score (1–10) for a feed item.
 *
 * Weights:
 *   Order value     → 30% (max 3.0)
 *   Sector relevance → 15% (max 1.5)
 *   Recency          → 20% (max 2.0)
 *   Keyword density  → 35% (max 3.5)
 *                              Total: 10.0
 */
export function calculateClientScore(
  extraction: ExtractionResult,
  pubDate: string,
): ClientScoreResult {
  const fullKeywords = extraction.matchedKeywords.map(k => k.toLowerCase());

  const orderValueScore = scoreOrderValue(
    extraction.orderValue,
    extraction.orderValueUnit,
  );
  const sectorScore = scoreSectorRelevance(
    fullKeywords,
    extraction.sectorTags,
  );
  const recencyScore = scoreRecency(pubDate);
  const keywordScore = scoreKeywordDensity(fullKeywords);

  // Weighted combination
  let totalScore =
    orderValueScore * 3.0 + // 30%
    sectorScore * 1.5 + // 15%
    recencyScore * 2.0 + // 20%
    keywordScore * 3.5; // 35%

  // Clamp to 1–10
  totalScore = Math.max(1, Math.min(10, Math.round(totalScore * 10) / 10));

  return {
    totalScore,
    keywordScore: Math.round(keywordScore * 100) / 100,
    sectorScore: Math.round(sectorScore * 100) / 100,
    recencyScore: Math.round(recencyScore * 100) / 100,
    orderValueScore: Math.round(orderValueScore * 100) / 100,
  };
}

/**
 * Blend a rule-based score with an AI score.
 * AI gets 60% weight because it understands nuance, context,
 * and company scale better than pure rule-based matching.
 */
export function blendScoreWithAI(
  ruleBasedScore: number,
  aiScore: number,
): number {
  const blended = ruleBasedScore * 0.4 + aiScore * 0.6;
  return Math.max(1, Math.min(10, Math.round(blended * 10) / 10));
}

// ── Component scorers ───────────────────────────────────

/**
 * Score based on order/contract value.
 * Higher values = higher scores.
 */
function scoreOrderValue(value?: number, unit?: string): number {
  if (!value) {
    return 0.3;
  }

  // Normalize to crores for comparison
  let crValue = value;
  if (unit === 'Lakh') {
    crValue = value / 100;
  }
  if (unit === 'Bn') {
    crValue = value * 100;
  }
  if (unit === 'Mn') {
    crValue = value / 10;
  }

  if (crValue >= 10000) {
    return 1.0;
  }
  if (crValue >= 5000) {
    return 0.9;
  }
  if (crValue >= 1000) {
    return 0.8;
  }
  if (crValue >= 500) {
    return 0.7;
  }
  if (crValue >= 100) {
    return 0.6;
  }
  if (crValue >= 50) {
    return 0.5;
  }
  if (crValue >= 10) {
    return 0.4;
  }
  return 0.3;
}

/**
 * Score sector relevance — hot/trending sectors get a boost.
 */
function scoreSectorRelevance(
  keywords: string[],
  sectorTags: string[],
): number {
  let score = 0.3;

  // Boost for trending sectors
  const boostMatches = SECTOR_BOOST_KEYWORDS.filter(kw =>
    keywords.some(k => k.includes(kw)),
  );
  score += Math.min(boostMatches.length * 0.15, 0.5);

  // More sector tags = more market relevance
  score += Math.min(sectorTags.length * 0.1, 0.2);

  return Math.min(score, 1.0);
}

/**
 * Score based on how recent the item is.
 */
function scoreRecency(pubDate: string): number {
  const publishedAt = new Date(pubDate).getTime();
  const hoursAgo = (Date.now() - publishedAt) / (1000 * 60 * 60);

  if (hoursAgo < 1) {
    return 1.0;
  }
  if (hoursAgo < 4) {
    return 0.9;
  }
  if (hoursAgo < 12) {
    return 0.7;
  }
  if (hoursAgo < 24) {
    return 0.5;
  }
  if (hoursAgo < 48) {
    return 0.3;
  }
  return 0.2;
}

/**
 * Score keyword density as a proxy for significance.
 */
function scoreKeywordDensity(keywords: string[]): number {
  const highImpactMatches = HIGH_IMPACT_KEYWORDS.filter(kw =>
    keywords.some(k => k.includes(kw.toLowerCase())),
  );

  if (highImpactMatches.length >= 3) {
    return 0.9;
  }
  if (highImpactMatches.length >= 2) {
    return 0.7;
  }
  if (highImpactMatches.length >= 1) {
    return 0.5;
  }
  return 0.3;
}
