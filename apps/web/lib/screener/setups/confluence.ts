/**
 * Confluence Entry Screener — the highest-probability setup.
 *
 * Fires only when ALL THREE entry screeners trigger simultaneously:
 *   1. 20 DMA Pullback
 *   2. RSI(7) Reaction
 *   3. Stochastics(7,10) Reaction
 *
 * Long: all three in weekly uptrend
 * Short: all three in weekly downtrend
 */

import type { UniverseStock } from '../universe';
import type { CandidateHit, SetupDirection } from './types';

const SETUP_VERSION = 'v1';

export function confluence(
  universe: UniverseStock[],
  direction: SetupDirection,
): CandidateHit[] {
  const hits: CandidateHit[] = [];

  for (const stock of universe) {
    if (
      stock.sma20 == null ||
      stock.sma20Prev == null ||
      stock.closePrev == null ||
      stock.rsi7 == null ||
      stock.rsi7Prev == null ||
      stock.stochK == null ||
      stock.stochKPrev == null ||
      stock.weeklyTrend == null
    ) {
      continue;
    }

    if (direction === 'long') {
      const trendOk = stock.weeklyTrend === 'UP';
      const dmaOk = stock.closePrev < stock.sma20Prev && stock.close > stock.sma20;
      const rsiOk = stock.rsi7Prev < 40 && stock.rsi7 > stock.rsi7Prev;
      const stochOk = stock.stochKPrev < 20 && stock.stochK > stock.stochKPrev;

      if (trendOk && dmaOk && rsiOk && stochOk) {
        hits.push({
          ticker: stock.ticker,
          setupName: `confluence-long@${SETUP_VERSION}`,
          direction: 'long',
          screenValues: {
            close: stock.close,
            closePrev: stock.closePrev,
            sma20: stock.sma20,
            sma20Prev: stock.sma20Prev,
            rsi7: stock.rsi7,
            rsi7Prev: stock.rsi7Prev,
            stochK: stock.stochK,
            stochKPrev: stock.stochKPrev,
            weeklyTrend: stock.weeklyTrend,
            roc20: stock.roc20,
          },
        });
      }
    } else {
      const trendOk = stock.weeklyTrend === 'DOWN';
      const dmaOk = stock.closePrev > stock.sma20Prev && stock.close < stock.sma20;
      const rsiOk = stock.rsi7Prev > 60 && stock.rsi7 < stock.rsi7Prev;
      const stochOk = stock.stochKPrev > 80 && stock.stochK < stock.stochKPrev;

      if (trendOk && dmaOk && rsiOk && stochOk) {
        hits.push({
          ticker: stock.ticker,
          setupName: `confluence-short@${SETUP_VERSION}`,
          direction: 'short',
          screenValues: {
            close: stock.close,
            closePrev: stock.closePrev,
            sma20: stock.sma20,
            sma20Prev: stock.sma20Prev,
            rsi7: stock.rsi7,
            rsi7Prev: stock.rsi7Prev,
            stochK: stock.stochK,
            stochKPrev: stock.stochKPrev,
            weeklyTrend: stock.weeklyTrend,
            roc20: stock.roc20,
          },
        });
      }
    }
  }

  return hits;
}
