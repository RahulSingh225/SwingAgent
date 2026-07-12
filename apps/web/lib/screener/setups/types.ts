/**
 * Shared types for screener setups.
 */

import type { UniverseStock } from '../universe';

export type SetupDirection = 'long' | 'short';

export interface CandidateHit {
  ticker: string;
  setupName: string;
  direction: SetupDirection;
  screenValues: Record<string, number | string>;
}

/**
 * A setup function receives the universe and direction,
 * and returns the stocks that pass the screen.
 */
export type SetupFn = (
  universe: UniverseStock[],
  direction: SetupDirection,
) => CandidateHit[];
