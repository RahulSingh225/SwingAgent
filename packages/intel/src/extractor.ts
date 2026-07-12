/**
 * Rule-based information extractor.
 * Ported from MarketFeeds — extracts ticker, sector, order value,
 * and keywords from announcement text.
 *
 * All functions are pure (no I/O, no async) for minimal CPU usage.
 * Regexes are pre-compiled at module level.
 */

import {ALL_KEYWORDS, KEYWORD_CATEGORIES} from './keywords';
import type {ExtractionResult} from './types';

// ── Pre-compiled regex patterns (allocated once) ─────────

const TICKER_PATTERN = /\b(?:NSE:\s*)?([A-Z]{2,20}(?:EQ)?)\b/;
const COMPANY_PATTERN =
  /([A-Z][A-Za-z\s&]+(?:Ltd\.?|Limited|Corporation|Corp\.?|Industries|Enterprises|Technologies|Tech|Solutions|Infra|Infrastructure|Pharma|Chemicals))/;

const ORDER_VALUE_PATTERNS: [RegExp, string][] = [
  [/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:crore|cr)\b/i, 'Cr'],
  [/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:lakh|lac)\b/i, 'Lakh'],
  [/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:billion|bn)\b/i, 'Bn'],
  [/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:million|mn)\b/i, 'Mn'],
  [
    /(?:order|contract|deal|project)\s+(?:worth|valued?\s+at|of)\s+(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(?:crore|cr)\b/i,
    'Cr',
  ],
  [
    /(?:order|contract|deal|project)\s+(?:worth|valued?\s+at|of)\s+(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(?:lakh|lac)\b/i,
    'Lakh',
  ],
  [/\b([\d,]+(?:\.\d+)?)\s*(?:crore|cr)\b/i, 'Cr'],
];

const CONTRACT_TYPES: [RegExp, string][] = [
  [/\border\s+win\b/i, 'Order Win'],
  [/\bwork\s+order\b/i, 'Work Order'],
  [/\bpurchase\s+order\b/i, 'Purchase Order'],
  [/\bepc\b/i, 'EPC Contract'],
  [/\bturnkey\b/i, 'Turnkey Project'],
  [/\bamc\b/i, 'AMC Contract'],
  [/\bletter\s+of\s+intent\b|\bloi\b/i, 'LoI'],
  [/\bpal\b|\bproduct\s+approval\b/i, 'Product Approval'],
  [/\bacquisition\b/i, 'Acquisition'],
  [/\bmerger\b/i, 'Merger'],
  [/\bjoint\s+venture\b|\bjv\b/i, 'Joint Venture'],
  [/\bbuyback\b/i, 'Buyback'],
  [/\bdividend\b/i, 'Dividend'],
  [/\bbonus\b/i, 'Bonus Issue'],
  [/\bstock\s+split\b/i, 'Stock Split'],
  [/\bquarterly\s+results?\b/i, 'Quarterly Results'],
  [/\bblock\s+deal\b/i, 'Block Deal'],
  [/\bbulk\s+deal\b/i, 'Bulk Deal'],
];

const TICKER_FALSE_POSITIVES = new Set([
  'BSE', 'NSE', 'SEBI', 'RBI', 'IPO', 'OFS', 'QIP', 'AGM', 'EGM',
  'CEO', 'CFO', 'CTO', 'CMD', 'FPO', 'NPA', 'ROE', 'PAT', 'EPS',
  'THE', 'AND', 'FOR', 'LTD', 'PVT', 'INC', 'CORP', 'HAS', 'WAS',
  'NEW', 'OLD', 'ALL', 'NOT', 'BUT', 'HAD', 'HIS', 'HER', 'ITS',
  'API', 'SaaS', 'RSS', 'URL', 'PDF',
]);

// ── Main extraction function ────────────────────────────

/**
 * Extract structured information from title + content text.
 * Returns all intelligence fields in a single pass.
 */
export function extractFromText(
  title: string,
  content: string,
): ExtractionResult {
  const fullText = `${title} ${content}`.toLowerCase();
  const originalText = `${title} ${content}`;

  return {
    ticker: extractTicker(originalText),
    companyName: extractCompanyName(originalText),
    sector: detectSector(fullText),
    sectorTags: detectSectorTags(fullText),
    orderValue: extractOrderValue(fullText),
    orderValueUnit: extractOrderValueUnit(fullText),
    contractType: extractContractType(fullText),
    matchedKeywords: findMatchedKeywords(fullText),
  };
}

// ── Individual extractors ───────────────────────────────

function extractTicker(text: string): string | undefined {
  const match = text.match(TICKER_PATTERN);
  if (match) {
    const candidate = match[1].replace(/EQ$/, '');
    if (!TICKER_FALSE_POSITIVES.has(candidate) && candidate.length >= 3) {
      return candidate;
    }
  }
  return undefined;
}

function extractCompanyName(text: string): string | undefined {
  const match = text.match(COMPANY_PATTERN);
  return match?.[1]?.trim();
}

/**
 * Detect primary sector by counting keyword matches.
 * Returns the sector with the highest match count.
 */
function detectSector(text: string): string | undefined {
  const sectorKeywordMap: Record<string, readonly string[]> = {
    Defense: KEYWORD_CATEGORIES['Defense'],
    Telecom: KEYWORD_CATEGORIES['Telecom'],
    'IT & Technology': KEYWORD_CATEGORIES['IT & Technology'],
    'Pharma & Healthcare': KEYWORD_CATEGORIES['Pharma & Healthcare'],
    'Banking & Finance': KEYWORD_CATEGORIES['Banking & Finance'],
    Infrastructure: KEYWORD_CATEGORIES['Infrastructure'],
  };

  let bestSector: string | undefined;
  let bestScore = 0;

  for (const [sector, keywords] of Object.entries(sectorKeywordMap)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestSector = sector;
    }
  }

  return bestSector;
}

/**
 * Detect all matching category tags (may match multiple).
 */
function detectSectorTags(text: string): string[] {
  const tags: string[] = [];

  for (const [category, keywords] of Object.entries(KEYWORD_CATEGORIES)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        tags.push(category);
        break; // One match per category is enough
      }
    }
  }

  return tags;
}

/**
 * Extract monetary order value using Indian number format patterns.
 */
function extractOrderValue(text: string): number | undefined {
  for (const [pattern] of ORDER_VALUE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const value = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(value) && value > 0) {
        return value;
      }
    }
  }
  return undefined;
}

function extractOrderValueUnit(text: string): string | undefined {
  if (/crore|cr\b/i.test(text)) {
    return 'Cr';
  }
  if (/lakh|lac\b/i.test(text)) {
    return 'Lakh';
  }
  if (/billion|bn\b/i.test(text)) {
    return 'Bn';
  }
  if (/million|mn\b/i.test(text)) {
    return 'Mn';
  }
  return undefined;
}

function extractContractType(text: string): string | undefined {
  for (const [pattern, type] of CONTRACT_TYPES) {
    if (pattern.test(text)) {
      return type;
    }
  }
  return undefined;
}

/**
 * Find all financial keywords present in the text.
 */
function findMatchedKeywords(text: string): string[] {
  return ALL_KEYWORDS.filter(kw => text.includes(kw.toLowerCase()));
}
