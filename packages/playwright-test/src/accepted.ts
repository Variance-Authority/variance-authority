import type { Observation } from '@variance-authority/observe';
import { bulkSkips } from '@variance-authority/report';
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
 * `=changed` sweeps the suite as `variance accept --all` does and skips what that
 * sweep skips (`bulkSkips`): an `incomparable` subject not shown to be the same
 * document re-painted under a new recipe, which includes another machine's
 * image. `=all` overwrites every image it takes, as naming a subject does.
 */
export function adopts(observation: Observation, run: VarianceRun): boolean {
  if (run.accepting !== true || observation.verdict === 'unchanged') return false;
  return run.overwriting === true || !bulkSkips(observation);
}
