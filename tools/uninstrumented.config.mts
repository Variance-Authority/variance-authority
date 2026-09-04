import { suite } from '../vitest.config.mjs';

/**
 * The suite with the probes taken away, and nothing else changed.
 *
 * `yarn test` records what it executes, and the claim that this costs nothing
 * only means anything against a run that does not — same files, same runner,
 * same environment, one plugin fewer. That comparison is
 * [journal 0027](../docs/context/journal/0027-what-instrumentation-costs.md)'s
 * suite arm, and it is the reason this file is a re-export rather than a copy of
 * the configuration: two arms that can drift are one arm and a coincidence.
 *
 * It is also the first thing to reach for when the suite fails in a way that
 * looks like the instrumenter — a `__va is not defined` from a page, a module
 * that will not parse. If it fails here too, it is not the probes.
 */
export default suite;
