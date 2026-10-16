/**
 * The probe recipes' names, apart from the recipes.
 *
 * Whatever reports what a process ran has to say which recipe placed the
 * probes, and some of what reports runs where the parser cannot: a Worker
 * bundles the journey head, and workerd has no native addon to load. So the
 * names import nothing.
 */

import type { InstrumentMode } from './spliced.js';

/** Changes whenever two instrumented block universes must not share observations. */
export const INSTRUMENTATION_ID = 'sense:instrument/presence-v6';

/**
 * The recipe each mode emits under. One identity per mode, because the two
 * walks number regions differently: ordinal 3 under `entries` is a function,
 * and under `presence` it may be the `else` of the module's first `if`. A
 * record, journal or snapshot cut under one is not evidence about the other.
 */
const IDS: Readonly<Record<InstrumentMode, string>> = {
  presence: INSTRUMENTATION_ID,
  entries: 'sense:instrument/entries-v3',
};

/**
 * The probes a run under `mode` records under: the identity its record is
 * stamped with, and the one a record must carry for that run to be laid over
 * it.
 */
export function instrumentationId(mode: InstrumentMode = 'presence'): string {
  return IDS[mode];
}

/** The mode an identity names, or nothing for a recipe this build does not emit. */
export function instrumentModeOf(instrumentation: string): InstrumentMode | undefined {
  return (Object.keys(IDS) as InstrumentMode[]).find((mode) => IDS[mode] === instrumentation);
}

const OURS = 'sense:instrument/';

/**
 * What this build places instead of the probes `instrumentation` names, when
 * that is a recipe of ours this build no longer emits: the same mode's current
 * identity when the old one names its mode, else every current one. Nothing for
 * a current recipe, and nothing for an identity outside our namespace, which is
 * not ours to call retired.
 */
export function retiredProbes(instrumentation: string): readonly string[] | undefined {
  if (!instrumentation.startsWith(OURS) || instrumentModeOf(instrumentation) !== undefined) return undefined;
  const mode = (Object.keys(IDS) as InstrumentMode[]).find((name) => instrumentation.startsWith(`${OURS}${name}-`));
  return mode === undefined ? Object.values(IDS) : [IDS[mode]];
}
