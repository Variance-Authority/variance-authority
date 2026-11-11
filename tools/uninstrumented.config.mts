import { slice } from '../vitest.config.mjs';

/**
 * The unit slice with the probes taken away: the suite arm of
 * [journal 0027](../docs/context/journal/0027-what-instrumentation-costs.md),
 * asked of `slice` so the two arms cannot drift. A failure that also happens
 * here is not the probes.
 */
export default slice('unit');
