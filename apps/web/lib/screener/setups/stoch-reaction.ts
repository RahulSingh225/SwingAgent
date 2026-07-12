/**
 * Stochastics (7, 10) Reaction Screener — long + short variants.
 *
 * Long: weekly trend UP, Slow %K yesterday < 20, %K today > yesterday (turning up)
 * Short: weekly trend DOWN, Slow %K yesterday > 80, %K today < yesterday (turning down)
 */

import type { UniverseStock } from '../universe';
import type { CandidateHit, SetupDirection } from './types';

const SETUP_VERSION = 'v1';

export function stochReaction(
  universe: UniverseStock[],
  direction: SetupDirection,
): CandidateHit[] {
  const hits: CandidateHit[] = [];

  for (const stock of universe) {
    if (
      stock.stochK == null ||
      stock.stochKPrev == null ||
      stock.weeklyTrend == null
    ) {
      continue;
    }

    if (direction === 'long') {
      // Weekly uptrend + Stoch oversold bounce
      if (
        stock.weeklyTrend === 'UP' &&
        stock.stochKPrev < 20 &&
        stock.stochK > stock.stochKPrev
      ) {
        hits.push({
          ticker: stock.ticker,
          setupName: `stoch-reaction-long@${SETUP_VERSION}`,
          direction: 'long',
          screenValues: {
            close: stock.close,
            stochK: stock.stochK,
            stochKPrev: stock.stochKPrev,
            weeklyTrend: stock.weeklyTrend,
            roc20: stock.roc20,
          },
        });
      }
    } else {
      // Weekly downtrend + Stoch overbought rejection
      if (
        stock.weeklyTrend === 'DOWN' &&
        stock.stochKPrev > 80 &&
        stock.stochK < stock.stochKPrev
      ) {
        hits.push({
          ticker: stock.ticker,
          setupName: `stoch-reaction-short@${SETUP_VERSION}`,
          direction: 'short',
          screenValues: {
            close: stock.close,
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
