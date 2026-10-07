import type { Observation } from '@variance-authority/observe';
import type { VarianceRun } from './run.js';

/** Report the state after Playwright's explicit snapshot update promoted it. */
export function accepted(observation: Observation): Observation {
  const { comparison, ...rest } = observation;
  void comparison;

  return {
    ...rest,
    verdict: 'unchanged',
    because: `accepted under --update-snapshots (${observation.because}); this run's image is the baseline`,
    regions: [],
  };
}

/**
 * Whether an accepting run adopts this observation's image.
 *
 * Every verdict that moved, but one: an `incomparable` subject painted under a
 * new recipe from a document the baseline was not painted from. No comparison
 * read that image, so a sweep over the suite passes it by, as `variance accept
 * --all` does (`promotionOf` in @variance-authority/report); a run that
 * overwrites every image it takes adopts it.
 */
export function adopts(observation: Observation, run: VarianceRun): boolean {
  if (run.accepting !== true || observation.verdict === 'unchanged') return false;
  const unread = observation.verdict === 'incomparable' && observation.signals?.document === 'changed';
  return !unread || run.overwriting === true;
}
