import { restamps, type Observation } from '@variance-authority/observe';
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
 * Whether an accepting run adopts this observation's image: every one that is
 * not already the baseline, as `variance accept --all` does. A change painted
 * under another identity is adopted like any other change (ADR-0090), and an
 * unchanged one is re-stamped under this run's identity, so the move is named
 * once rather than on every later run. An unchanged one whose baseline kept no
 * snapshot is re-stamped too, so it keeps this run's.
 */
export function adopts(observation: Observation, run: VarianceRun): boolean {
  if (run.accepting !== true) return false;
  return observation.verdict !== 'unchanged' || restamps(observation);
}
