/**
 * Technical indicator math — pure functions over ordered OHLCV series.
 * All series are oldest → newest. Returns undefined when there is not
 * enough history rather than guessing.
 *
 * Conventions match common charting defaults (TradingView):
 *   - EMA seeded with the SMA of the first `period` values
 *   - RSI and ATR use Wilder's smoothing
 */

export interface OhlcvBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Simple moving average of the last `period` values. */
export function sma(values: number[], period: number): number | undefined {
  if (values.length < period || period <= 0) {
    return undefined;
  }
  const window = values.slice(-period);
  return window.reduce((a, b) => a + b, 0) / period;
}

/**
 * Exponential moving average of the full series, seeded with the SMA of
 * the first `period` values. Returns the latest EMA value.
 */
export function ema(values: number[], period: number): number | undefined {
  if (values.length < period || period <= 0) {
    return undefined;
  }
  const k = 2 / (period + 1);
  let current =
    values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    current = values[i] * k + current * (1 - k);
  }
  return current;
}

/**
 * Wilder's RSI over closes. Needs at least `period + 1` values.
 * Returns 100 when there are no losses in the window, 0 when no gains.
 */
export function rsi(closes: number[], period = 14): number | undefined {
  if (closes.length < period + 1) {
    return undefined;
  }

  let avgGain = 0;
  let avgLoss = 0;

  // Seed with simple averages over the first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      avgGain += change;
    } else {
      avgLoss -= change;
    }
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing over the rest
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) {
    return avgGain === 0 ? 50 : 100;
  }
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/**
 * Wilder's ATR over OHLC bars. Needs at least `period + 1` bars
 * (true range uses the previous close).
 */
export function atr(bars: OhlcvBar[], period = 14): number | undefined {
  if (bars.length < period + 1) {
    return undefined;
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    const {high, low} = bars[i];
    trueRanges.push(
      Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)),
    );
  }

  // Seed with the simple average of the first `period` TRs, then Wilder-smooth
  let current =
    trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    current = (current * (period - 1) + trueRanges[i]) / period;
  }
  return current;
}

/**
 * Percent distance of the latest close from the highest high of the last
 * `lookback` bars (252 ≈ 52 weeks). Negative below the high, 0 at the high.
 */
export function pctFromHigh(
  bars: OhlcvBar[],
  lookback = 252,
): number | undefined {
  if (bars.length === 0) {
    return undefined;
  }
  const window = bars.slice(-lookback);
  const high = Math.max(...window.map(b => b.high));
  if (high <= 0) {
    return undefined;
  }
  const close = bars[bars.length - 1].close;
  return ((close - high) / high) * 100;
}

/** Average volume of the last `period` bars. */
export function avgVolume(
  bars: OhlcvBar[],
  period = 20,
): number | undefined {
  return sma(bars.map(b => b.volume), period);
}

/**
 * Rate of change over `period` bars.
 * ROC = ((close_today - close_N_ago) / close_N_ago) * 100
 */
export function roc(closes: number[], period = 20): number | undefined {
  if (closes.length < period + 1) {
    return undefined;
  }
  const prev = closes[closes.length - 1 - period];
  const curr = closes[closes.length - 1];
  if (prev <= 0) {
    return undefined;
  }
  return ((curr - prev) / prev) * 100;
}

/**
 * Slow Stochastic %K and %D.
 * Raw %K = ((close - lowest low) / (highest high - lowest low)) * 100 over kPeriod.
 * Slow %K = SMA(raw %K, dPeriod).
 * Slow %D = SMA(slow %K, dPeriod) — we only need %K for the screener.
 *
 * Returns the slow %K value for the latest bar.
 */
export interface StochasticResult {
  k: number;
  kPrev?: number;
}

export function slowStochastic(
  bars: OhlcvBar[],
  kPeriod = 7,
  dPeriod = 10,
): StochasticResult | undefined {
  if (bars.length < kPeriod + dPeriod) {
    return undefined;
  }

  // Compute raw %K for each bar from index (kPeriod-1) onward
  const rawKs: number[] = [];
  for (let i = kPeriod - 1; i < bars.length; i++) {
    const window = bars.slice(i - kPeriod + 1, i + 1);
    const lowestLow = Math.min(...window.map(b => b.low));
    const highestHigh = Math.max(...window.map(b => b.high));
    const range = highestHigh - lowestLow;
    const rawK = range > 0 ? ((bars[i].close - lowestLow) / range) * 100 : 50;
    rawKs.push(rawK);
  }

  // Slow %K = SMA of raw %K over dPeriod
  if (rawKs.length < dPeriod) {
    return undefined;
  }

  const slowKs: number[] = [];
  for (let i = dPeriod - 1; i < rawKs.length; i++) {
    const window = rawKs.slice(i - dPeriod + 1, i + 1);
    slowKs.push(window.reduce((a, b) => a + b, 0) / dPeriod);
  }

  if (slowKs.length < 2) {
    return { k: slowKs[slowKs.length - 1] };
  }

  return {
    k: slowKs[slowKs.length - 1],
    kPrev: slowKs[slowKs.length - 2],
  };
}

/**
 * Weekly trend determination using Option C: EMA(20) > EMA(50) on daily.
 * Returns 'UP' when ema20 > ema50, 'DOWN' when ema20 < ema50, 'FLAT' otherwise.
 */
export function weeklyTrend(
  ema20Val?: number,
  ema50Val?: number,
): 'UP' | 'DOWN' | 'FLAT' {
  if (ema20Val == null || ema50Val == null) {
    return 'FLAT';
  }
  const diff = ((ema20Val - ema50Val) / ema50Val) * 100;
  if (diff > 0.1) return 'UP';
  if (diff < -0.1) return 'DOWN';
  return 'FLAT';
}

/** Everything the `indicators` table needs, computed in one pass. */
export interface IndicatorSet {
  ema20?: number;
  ema50?: number;
  ema200?: number;
  avgVol20?: number;
  atr14?: number;
  pctFrom52wHigh?: number;
  rsi14?: number;
  // Phase 4 additions
  sma20?: number;
  sma20Prev?: number;
  closePrev?: number;
  roc20?: number;
  rsi7?: number;
  rsi7Prev?: number;
  stochK?: number;
  stochKPrev?: number;
  weeklyTrendVal?: 'UP' | 'DOWN' | 'FLAT';
}

export function computeIndicators(bars: OhlcvBar[]): IndicatorSet {
  const closes = bars.map(b => b.close);
  const ema20Val = ema(closes, 20);
  const ema50Val = ema(closes, 50);

  // SMA20 today + yesterday
  const sma20Val = sma(closes, 20);
  const sma20PrevVal = closes.length >= 21 ? sma(closes.slice(0, -1), 20) : undefined;

  // Close today + yesterday
  const closePrevVal = closes.length >= 2 ? closes[closes.length - 2] : undefined;

  // RSI(7) today + yesterday
  const rsi7Val = rsi(closes, 7);
  const rsi7PrevVal = closes.length >= 9 ? rsi(closes.slice(0, -1), 7) : undefined;

  // Slow stochastic
  const stoch = slowStochastic(bars, 7, 10);

  return {
    ema20: ema20Val,
    ema50: ema50Val,
    ema200: ema(closes, 200),
    avgVol20: avgVolume(bars, 20),
    atr14: atr(bars, 14),
    pctFrom52wHigh: pctFromHigh(bars, 252),
    rsi14: rsi(closes, 14),
    // Phase 4
    sma20: sma20Val,
    sma20Prev: sma20PrevVal,
    closePrev: closePrevVal,
    roc20: roc(closes, 20),
    rsi7: rsi7Val,
    rsi7Prev: rsi7PrevVal,
    stochK: stoch?.k,
    stochKPrev: stoch?.kPrev,
    weeklyTrendVal: weeklyTrend(ema20Val, ema50Val),
  };
}
