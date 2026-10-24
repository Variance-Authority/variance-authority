import { describe, it } from 'vitest';

/**
 * `variance covering --file` held to spec 0104: which tests entered a file.
 * The wins it keeps are pinned where they live — per region and suite
 * (`covering-read`, `covering-suites`), declared preconditions
 * (`covering-preconditions`), a record under older probes (`covering-probes`),
 * a suite with no record (`covering-unrecorded`). These are the facts it does
 * not hold yet.
 */

describe('variance covering --file', () => {
  it.todo('reads a path under dist/ as the source file it was built from — needs the resolver\'s outDir-to-rootDir mapping applied to the asked path');
  it.todo('answers a test file by the cases it holds, and a missing path once, as missing — needs a test file answered from its own cases, and a missing path checked before any suite');
  it.todo('prints repository-relative paths only, never the cache directory — needs every printed path made relative to the checkout');
  it.todo('names the commit its record was made at, and whether the file changed since — needs the record\'s commit read from its ledger and compared with the file\'s last change');
  it.todo('says the probe-version notice once per answer, not once per suite — needs the notice gathered across suites and printed after them');
  it.todo('answers in JSON one row per region and case, with no repeated case — needs the JSON keyed by region with each case listed once');
  it.todo('exits 1 when no record holds the file — needs the exit code chosen from the answer');
});
