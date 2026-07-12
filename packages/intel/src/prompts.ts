/**
 * AI analysis prompt + response parsing.
 * Ported from AlertsReader's ollamaService — the prompt and return format
 * are unchanged so existing `AIAnalysis` parsing carries over. Provider
 * agnostic: works with any LLM that returns the JSON contract below
 * (Ollama, Gemini, Claude).
 */

import type {AIAnalysis, ExtractionResult} from './types';

/**
 * Build the analysis prompt for the LLM.
 * Carefully engineered for Indian stock market context.
 */
export function buildAnalysisPrompt(
  title: string,
  snippet: string,
  ruleBasedContext?: Partial<ExtractionResult>,
): string {
  const contextLines: string[] = [];

  if (ruleBasedContext?.ticker) {
    contextLines.push(`Detected Ticker: ${ruleBasedContext.ticker}`);
  }
  if (ruleBasedContext?.companyName) {
    contextLines.push(`Company: ${ruleBasedContext.companyName}`);
  }
  if (ruleBasedContext?.orderValue && ruleBasedContext?.orderValueUnit) {
    contextLines.push(
      `Order Value: ₹${ruleBasedContext.orderValue} ${ruleBasedContext.orderValueUnit}`,
    );
  }
  if (ruleBasedContext?.sector) {
    contextLines.push(`Sector: ${ruleBasedContext.sector}`);
  }
  if (ruleBasedContext?.contractType) {
    contextLines.push(`Contract Type: ${ruleBasedContext.contractType}`);
  }

  const contextBlock =
    contextLines.length > 0
      ? `\n\nPre-extracted context:\n${contextLines.join('\n')}`
      : '';

  return `You are an expert Indian stock market analyst specializing in identifying share-price-moving events. Analyze this news alert and provide a structured trading assessment.

NEWS TITLE: ${title}
NEWS SNIPPET: ${snippet}${contextBlock}

Respond ONLY with a valid JSON object (no markdown, no explanation) with these exact fields:
{
  "ai_score": <number 1-10, where 10 = extremely market-moving like major acquisition/order win, 1 = routine/no impact>,
  "summary": "<2-3 sentence trader's take: what happened, why it matters for the stock, what to watch next>",
  "sentiment": "<exactly one of: Bullish, Bearish, Neutral>",
  "confidence": "<exactly one of: High, Medium, Low>",
  "price_prediction": "<predicted price action e.g. 'Up 3-5% short term' or 'Neutral - no material impact'>",
  "counterparty": "<who gave the order/contract, or null if N/A>",
  "order_type": "<New Order, Repeat Order, Follow-on, or null if not an order>",
  "revenue_impact": "<estimated impact on company revenue e.g. '~8% of annual revenue', or null if unknown>",
  "key_insight": "<single most important takeaway for a trader>",
  "risk_factors": "<potential risks or reasons this might not move the stock, or null>"
}

Scoring guide:
- 9-10: Major M&A, large order win (>500 Cr), regulatory approval, block/bulk deal
- 7-8: Significant order win, quarterly results beat, dividend, JV with major company
- 5-6: Moderate order, routine contract, management change
- 3-4: Minor news, routine filing, small order
- 1-2: No market impact, general industry news`;
}

/**
 * Parse the LLM's JSON response into a typed AIAnalysis.
 * Robust against malformed or partial responses — returns null on failure.
 */
export function parseAIAnalysisResponse(
  responseText: string,
): AIAnalysis | null {
  try {
    // Try to extract JSON from the response (handle markdown wrapping)
    let jsonStr = responseText.trim();

    // Remove markdown code fences if present
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    // Find the JSON object
    const jsonStart = jsonStr.indexOf('{');
    const jsonEnd = jsonStr.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      console.warn('[intel] No JSON object found in AI response');
      return null;
    }
    jsonStr = jsonStr.substring(jsonStart, jsonEnd + 1);

    const data = JSON.parse(jsonStr);

    // Validate required fields
    if (typeof data.ai_score !== 'number' || !data.summary || !data.sentiment) {
      console.warn('[intel] Missing required fields in AI response');
      return null;
    }

    // Normalize sentiment
    const sentimentMap: Record<string, 'Bullish' | 'Bearish' | 'Neutral'> = {
      bullish: 'Bullish',
      bearish: 'Bearish',
      neutral: 'Neutral',
      positive: 'Bullish',
      negative: 'Bearish',
    };
    const sentiment =
      sentimentMap[String(data.sentiment).toLowerCase()] || 'Neutral';

    // Normalize confidence
    const confidenceMap: Record<string, 'High' | 'Medium' | 'Low'> = {
      high: 'High',
      medium: 'Medium',
      low: 'Low',
    };
    const confidence =
      confidenceMap[String(data.confidence).toLowerCase()] || 'Medium';

    return {
      aiScore: Math.max(1, Math.min(10, Math.round(data.ai_score))),
      summary: String(data.summary).substring(0, 500),
      sentiment,
      confidence,
      pricePrediction: String(data.price_prediction || 'N/A').substring(0, 100),
      counterparty: data.counterparty
        ? String(data.counterparty).substring(0, 100)
        : undefined,
      orderType: data.order_type
        ? String(data.order_type).substring(0, 50)
        : undefined,
      revenueImpact: data.revenue_impact
        ? String(data.revenue_impact).substring(0, 100)
        : undefined,
      keyInsight: data.key_insight
        ? String(data.key_insight).substring(0, 200)
        : undefined,
      riskFactors: data.risk_factors
        ? String(data.risk_factors).substring(0, 200)
        : undefined,
      analyzedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[intel] Failed to parse AI response:', err);
    return null;
  }
}
