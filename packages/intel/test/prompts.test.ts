import {describe, expect, it} from 'vitest';
import {buildAnalysisPrompt, parseAIAnalysisResponse} from '../src/prompts';

describe('buildAnalysisPrompt', () => {
  it('embeds title, snippet and pre-extracted context', () => {
    const prompt = buildAnalysisPrompt('Big order win', 'Details here', {
      ticker: 'SUZLON',
      orderValue: 500,
      orderValueUnit: 'Cr',
    });

    expect(prompt).toContain('NEWS TITLE: Big order win');
    expect(prompt).toContain('NEWS SNIPPET: Details here');
    expect(prompt).toContain('Detected Ticker: SUZLON');
    expect(prompt).toContain('Order Value: ₹500 Cr');
  });

  it('omits the context block when nothing was extracted', () => {
    const prompt = buildAnalysisPrompt('Title', 'Snippet');

    expect(prompt).not.toContain('Pre-extracted context');
  });
});

describe('parseAIAnalysisResponse', () => {
  const valid = {
    ai_score: 8,
    summary: 'Large order win, meaningful revenue addition.',
    sentiment: 'Bullish',
    confidence: 'High',
    price_prediction: 'Up 3-5% short term',
    counterparty: 'NTPC',
    order_type: 'New Order',
    revenue_impact: '~8% of annual revenue',
    key_insight: 'Order book now covers 2 years of revenue',
    risk_factors: 'Execution timeline risk',
  };

  it('parses a clean JSON response', () => {
    const result = parseAIAnalysisResponse(JSON.stringify(valid));

    expect(result).not.toBeNull();
    expect(result!.aiScore).toBe(8);
    expect(result!.sentiment).toBe('Bullish');
    expect(result!.counterparty).toBe('NTPC');
  });

  it('parses a markdown-fenced response', () => {
    const fenced = '```json\n' + JSON.stringify(valid) + '\n```';

    expect(parseAIAnalysisResponse(fenced)?.aiScore).toBe(8);
  });

  it('normalizes loose sentiment/confidence values and clamps the score', () => {
    const result = parseAIAnalysisResponse(
      JSON.stringify({...valid, ai_score: 15, sentiment: 'positive', confidence: 'HIGH'}),
    );

    expect(result!.aiScore).toBe(10);
    expect(result!.sentiment).toBe('Bullish');
    expect(result!.confidence).toBe('High');
  });

  it('returns null on garbage or incomplete responses', () => {
    expect(parseAIAnalysisResponse('not json at all')).toBeNull();
    expect(
      parseAIAnalysisResponse(JSON.stringify({summary: 'no score'})),
    ).toBeNull();
  });
});
