import {describe, expect, it} from 'vitest';
import {extractFromText} from '../src/extractor';

describe('extractFromText', () => {
  it('extracts ticker, order value and sector tags from an order-win alert', () => {
    const result = extractFromText(
      'SUZLON wins order worth ₹ 500 crore',
      'Wind energy order from NTPC for turbine supply',
    );

    expect(result.ticker).toBe('SUZLON');
    expect(result.orderValue).toBe(500);
    expect(result.orderValueUnit).toBe('Cr');
    expect(result.sectorTags).toContain('Infrastructure');
    expect(result.matchedKeywords).toContain('wind energy');
  });

  it('rejects known ticker false positives', () => {
    const result = extractFromText('RBI announces rate cut', '');

    expect(result.ticker).toBeUndefined();
    expect(result.sector).toBe('Banking & Finance');
    expect(result.matchedKeywords).toContain('rate cut');
  });

  it('classifies contract type', () => {
    const result = extractFromText(
      'Company bags work order from state utility',
      '',
    );

    expect(result.contractType).toBe('Work Order');
  });

  it('parses lakh-denominated values', () => {
    const result = extractFromText('Order worth Rs 50 lakh received', '');

    expect(result.orderValue).toBe(50);
    expect(result.orderValueUnit).toBe('Lakh');
  });

  it('extracts company names ending in a legal suffix', () => {
    const result = extractFromText(
      'Apar Industries secures export contract',
      '',
    );

    expect(result.companyName).toBe('Apar Industries');
  });

  it('returns empty collections for unrelated text', () => {
    const result = extractFromText('the weather is pleasant today', '');

    expect(result.matchedKeywords).toEqual([]);
    expect(result.sectorTags).toEqual([]);
    expect(result.orderValue).toBeUndefined();
  });
});
