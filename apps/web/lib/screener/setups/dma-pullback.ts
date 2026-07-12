/**
 * 20 DMA Pullback Screener — long + short variants.
 *
 * Long: weekly trend UP, yesterday close < SMA20, today close > SMA20
 * Short: weekly trend DOWN, yesterday close > SMA20, today close < SMA20
 */

import type { UniverseStock } from '../universe';
import type { CandidateHit, SetupDirection } from './types';

const SETUP_VERSION = 'v1';

export function dmaPullback(
  universe: UniverseStock[],
  direction: SetupDirection,
): CandidateHit[] {
  const hits: CandidateHit[] = [];

  for (const stock of universe) {
    if (
      stock.sma20 == null ||
      stock.sma20Prev == null ||
      stock.closePrev == null ||
      stock.weeklyTrend == null
    ) {
      continue;
    }

    if (direction === 'long') {
      // Weekly uptrend + cross back ABOVE 20 SMA
      if (
        stock.weeklyTrend === 'UP' &&
        stock.closePrev < stock.sma20Prev &&
        stock.close > stock.sma20
      ) {
        hits.push({
          ticker: stock.ticker,
          setupName: `dma-pullback-long@${SETUP_VERSION}`,
          direction: 'long',
          screenValues: {
            close: stock.close,
            closePrev: stock.closePrev,
            sma20: stock.sma20,
            sma20Prev: stock.sma20Prev,
            weeklyTrend: stock.weeklyTrend,
            roc20: stock.roc20,
          },
        });
      }
    } else {
      // Weekly downtrend + cross back BELOW 20 SMA
      if (
        stock.weeklyTrend === 'DOWN' &&
        stock.closePrev > stock.sma20Prev &&
        stock.close < stock.sma20
      ) {
        hits.push({
          ticker: stock.ticker,
          setupName: `dma-pullback-short@${SETUP_VERSION}`,
          direction: 'short',
          screenValues: {
            close: stock.close,
            closePrev: stock.closePrev,
            sma20: stock.sma20,
            sma20Prev: stock.sma20Prev,
            weeklyTrend: stock.weeklyTrend,
            roc20: stock.roc20,
          },
        });
      }
    }
  }

  return hits;
}
