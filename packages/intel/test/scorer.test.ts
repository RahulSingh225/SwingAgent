import {describe, expect, it} from 'vitest';
import {blendScoreWithAI, calculateClientScore} from '../src/scorer';
import type {ExtractionResult} from '../src/types';

const emptyExtraction: ExtractionResult = {
  sectorTags: [],
  matchedKeywords: [],
};

describe('calculateClientScore', () => {
  it('scores a stale, keyword-free item at the floor', () => {
    const result = calculateClientScore(
      emptyExtraction,
      '2020-01-01T00:00:00Z',
    );

    // 0.3*3.0 + 0.3*1.5 + 0.2*2.0 + 0.3*3.5 = 2.8
    expect(result.totalScore).toBe(2.8);
    expect(result.orderValueScore).toBe(0.3);
    expect(result.recencyScore).toBe(0.2);
  });

  it('scores a fresh mega-order near the top', () => {
    const extraction: ExtractionResult = {
      sectorTags: [],
      matchedKeywords: ['order win', 'acquisition', 'merger'],
      orderValue: 12000,
      orderValueUnit: 'Cr',
    };
    const result = calculateClientScore(extraction, new Date().toISOString());

    // 1.0*3.0 + 0.3*1.5 + 1.0*2.0 + 0.9*3.5 = 8.6
    expect(result.totalScore).toBe(8.6);
    expect(result.orderValueScore).toBe(1.0);
    expect(result.keywordScore).toBe(0.9);
  });

  it('normalizes order value units to crores', () => {
    const lakhs = calculateClientScore(
      {...emptyExtraction, orderValue: 5000, orderValueUnit: 'Lakh'},
      '2020-01-01T00:00:00Z',
    );
    // 5000 Lakh = 50 Cr → 0.5
    expect(lakhs.orderValueScore).toBe(0.5);

    const billions = calculateClientScore(
      {...emptyExtraction, orderValue: 10, orderValueUnit: 'Bn'},
      '2020-01-01T00:00:00Z',
    );
    // 10 Bn = 1000 Cr → 0.8
    expect(billions.orderValueScore).toBe(0.8);
  });
});

describe('blendScoreWithAI', () => {
  it('weights AI at 60%', () => {
    expect(blendScoreWithAI(5, 10)).toBe(8);
  });

  it('clamps to the 1-10 range', () => {
    expect(blendScoreWithAI(10, 10)).toBe(10);
    expect(blendScoreWithAI(0, 0)).toBe(1);
  });
});
