/**
 * 7-Day RSI Reaction Screener — long + short variants.
 *
 * Long: weekly trend UP, RSI(7) yesterday < 40, RSI(7) today > yesterday (turning up)
 * Short: weekly trend DOWN, RSI(7) yesterday > 60, RSI(7) today < yesterday (turning down)
 */

import type { UniverseStock } from '../universe';
import type { CandidateHit, SetupDirection } from './types';

const SETUP_VERSION = 'v1';

export function rsiReaction(
  universe: UniverseStock[],
  direction: SetupDirection,
): CandidateHit[] {
  const hits: CandidateHit[] = [];

  for (const stock of universe) {
    if (
      stock.rsi7 == null ||
      stock.rsi7Prev == null ||
      stock.weeklyTrend == null
    ) {
      continue;
    }

    if (direction === 'long') {
      // Weekly uptrend + RSI(7) oversold bounce
      if (
        stock.weeklyTrend === 'UP' &&
        stock.rsi7Prev < 40 &&
        stock.rsi7 > stock.rsi7Prev
      ) {
        hits.push({
          ticker: stock.ticker,
          setupName: `rsi-reaction-long@${SETUP_VERSION}`,
          direction: 'long',
          screenValues: {
            close: stock.close,
            rsi7: stock.rsi7,
            rsi7Prev: stock.rsi7Prev,
            weeklyTrend: stock.weeklyTrend,
            roc20: stock.roc20,
          },
        });
      }
    } else {
      // Weekly downtrend + RSI(7) overbought rejection
      if (
        stock.weeklyTrend === 'DOWN' &&
        stock.rsi7Prev > 60 &&
        stock.rsi7 < stock.rsi7Prev
      ) {
        hits.push({
          ticker: stock.ticker,
          setupName: `rsi-reaction-short@${SETUP_VERSION}`,
          direction: 'short',
          screenValues: {
            close: stock.close,
            rsi7: stock.rsi7,
            rsi7Prev: stock.rsi7Prev,
            weeklyTrend: stock.weeklyTrend,
            roc20: stock.roc20,
          },
        });
      }
    }
  }

  return hits;
}
