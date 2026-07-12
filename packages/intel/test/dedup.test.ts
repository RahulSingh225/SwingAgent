import {describe, expect, it} from 'vitest';
import {
  areTitlesSimilar,
  deduplicateItems,
  generateContentHash,
  normalizeUrl,
} from '../src/dedup';

describe('normalizeUrl', () => {
  it('unwraps Google Alerts redirect URLs to the real destination', () => {
    const wrapped =
      'https://www.google.com/url?rct=j&sa=t&url=https://example.com/story/abc&ct=ga';

    expect(normalizeUrl(wrapped)).toBe('example.com/story/abc');
  });

  it('strips query params and trailing slashes from regular URLs', () => {
    expect(normalizeUrl('https://Example.com/News/?utm_source=x')).toBe(
      'example.com/news',
    );
  });

  it('two different Google redirects do not collapse into one', () => {
    const a =
      'https://www.google.com/url?url=https://siteA.com/article1&ct=ga';
    const b =
      'https://www.google.com/url?url=https://siteB.com/article2&ct=ga';

    expect(normalizeUrl(a)).not.toBe(normalizeUrl(b));
  });
});

describe('generateContentHash', () => {
  it('is deterministic and input-sensitive', () => {
    const h1 = generateContentHash('Title A', 'https://x.com/1');
    const h2 = generateContentHash('Title A', 'https://x.com/1');
    const h3 = generateContentHash('Title B', 'https://x.com/1');

    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

describe('areTitlesSimilar', () => {
  it('matches the same headline with a source suffix', () => {
    expect(
      areTitlesSimilar(
        'Reliance Industries wins 5000 crore solar order from SECI',
        'Reliance Industries wins 5000 crore solar order from SECI - Moneycontrol',
      ),
    ).toBe(true);
  });

  it('does not match unrelated headlines', () => {
    expect(
      areTitlesSimilar(
        'Tata Motors Q3 results beat street estimates',
        'Infosys announces mega deal with US client',
      ),
    ).toBe(false);
  });

  it('requires exact match for short titles', () => {
    expect(areTitlesSimilar('HAL order', 'BEL order')).toBe(false);
    expect(areTitlesSimilar('HAL order', 'HAL order')).toBe(true);
  });
});

describe('deduplicateItems', () => {
  it('removes exact URL and fuzzy title duplicates', () => {
    const items = [
      {
        title: 'Reliance Industries wins 5000 crore solar order from SECI',
        link: 'https://a.com/x',
      },
      {
        title: 'Completely different headline about the same link',
        link: 'https://a.com/x',
      },
      {
        title:
          'Reliance Industries wins 5000 crore solar order from SECI - Moneycontrol',
        link: 'https://b.com/y',
      },
    ];

    const result = deduplicateItems(items);

    expect(result).toHaveLength(1);
    expect(result[0].link).toBe('https://a.com/x');
  });

  it('keeps distinct items', () => {
    const items = [
      {title: 'Tata Motors Q3 results beat street estimates', link: 'https://a.com/1'},
      {title: 'Infosys announces mega deal with US client', link: 'https://b.com/2'},
    ];

    expect(deduplicateItems(items)).toHaveLength(2);
  });
});
