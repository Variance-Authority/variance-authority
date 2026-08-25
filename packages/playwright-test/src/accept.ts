import type { Observation } from '@variance-authority/observe';

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
