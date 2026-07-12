import {describe, expect, it} from 'vitest';
import {
  atr,
  avgVolume,
  computeIndicators,
  ema,
  pctFromHigh,
  rsi,
  sma,
  type OhlcvBar,
} from '../src/indicators';

function bar(close: number, spread = 0, volume = 1000): OhlcvBar {
  return {
    open: close,
    high: close + spread,
    low: close - spread,
    close,
    volume,
  };
}

describe('sma / ema', () => {
  it('sma averages the trailing window', () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([1, 2, 3, 4, 5], 2)).toBe(4.5);
  });

  it('returns undefined with insufficient data', () => {
    expect(sma([1, 2], 5)).toBeUndefined();
    expect(ema([1, 2], 5)).toBeUndefined();
  });

  it('ema of a constant series is the constant', () => {
    expect(ema(Array(50).fill(100), 20)).toBeCloseTo(100, 10);
  });

  it('ema matches a hand-computed small case', () => {
    // seed SMA(1,2,3)=2, k=0.5 → 4*0.5+2*0.5=3 → 5*0.5+3*0.5=4
    expect(ema([1, 2, 3, 4, 5], 3)).toBe(4);
  });
});

describe('rsi', () => {
  it("matches Wilder's classic reference series (~70.46)", () => {
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08,
      45.89, 46.03, 45.61, 46.28, 46.28,
    ];
    expect(rsi(closes, 14)).toBeCloseTo(70.46, 1);
  });

  it('is 100 on all-gains, 0 on all-losses, 50 when flat', () => {
    const up = Array.from({length: 20}, (_, i) => 100 + i);
    const down = Array.from({length: 20}, (_, i) => 100 - i);
    const flat = Array(20).fill(100);

    expect(rsi(up, 14)).toBe(100);
    expect(rsi(down, 14)).toBe(0);
    expect(rsi(flat, 14)).toBe(50);
  });

  it('needs period + 1 closes', () => {
    expect(rsi(Array(14).fill(1), 14)).toBeUndefined();
  });
});

describe('atr', () => {
  it('equals the constant true range on uniform bars', () => {
    // Every bar: high-low = 2, close in middle → TR = 2 throughout
    const bars = Array.from({length: 30}, () => bar(100, 1));
    expect(atr(bars, 14)).toBeCloseTo(2, 10);
  });

  it('picks up gaps via the previous close', () => {
    // 15 flat bars, then a bar gapping +10 with zero intra-bar range:
    // TR = |high - prevClose| = 10 enters the Wilder smoothing once.
    const bars = [...Array.from({length: 15}, () => bar(100, 0)), bar(110, 0)];
    // seed ATR = 0, then (0*13 + 10)/14
    expect(atr(bars, 14)).toBeCloseTo(10 / 14, 10);
  });

  it('needs period + 1 bars', () => {
    expect(atr(Array.from({length: 14}, () => bar(100, 1)), 14)).toBeUndefined();
  });
});

describe('pctFromHigh / avgVolume', () => {
  it('measures distance below the lookback high', () => {
    const bars = [bar(100, 0), {...bar(100, 0), high: 100}, bar(90, 0)];
    expect(pctFromHigh(bars, 252)).toBeCloseTo(-10, 10);
  });

  it('is 0 at a new high', () => {
    const bars = [bar(90, 0), bar(100, 0)];
    expect(pctFromHigh(bars, 252)).toBeCloseTo(0, 10);
  });

  it('averages trailing volume', () => {
    const bars = [
      ...Array.from({length: 19}, () => bar(100, 0, 1000)),
      bar(100, 0, 3000),
    ];
    expect(avgVolume(bars, 20)).toBe(1100);
  });
});

describe('computeIndicators', () => {
  it('returns undefined fields on short history, all fields on long history', () => {
    const short = computeIndicators([bar(100, 1), bar(101, 1)]);
    expect(short.ema200).toBeUndefined();
    expect(short.rsi14).toBeUndefined();
    expect(short.pctFrom52wHigh).toBeDefined(); // works from bar 1

    const long = computeIndicators(
      Array.from({length: 300}, (_, i) => bar(100 + Math.sin(i / 10) * 5, 1)),
    );
    expect(long.ema20).toBeDefined();
    expect(long.ema50).toBeDefined();
    expect(long.ema200).toBeDefined();
    expect(long.avgVol20).toBeDefined();
    expect(long.atr14).toBeDefined();
    expect(long.rsi14).toBeDefined();
    expect(long.pctFrom52wHigh).toBeDefined();
  });
});
