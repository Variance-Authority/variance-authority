/**
 * The probe recipes' names, apart from the recipes.
 *
 * Whatever reports what a process ran has to say which recipe placed the
 * probes, and some of what reports runs where the parser cannot: a Worker
 * bundles the journey head, and workerd has no native addon to load. So the
 * names import nothing.
 */

import type { InstrumentMode, WalkMode } from './spliced.js';

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
  loads: 'sense:instrument/loads-v1',
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

/**
 * Whether `mode` probes regions. A test file is cut, and a case scoped, only
 * to say which test line and which case reached a region first; `loads` marks
 * a module as its file loads it, before any case opens, and has no region to
 * charge to either. No mode is `presence`.
 */
export function probesRegions(mode: InstrumentMode | undefined): mode is WalkMode | undefined {
  return mode !== 'loads';
}
