/**
 * A test never inherits the selection that chose it.
 *
 * `yarn test:since` selects by setting `VARIANCE_AUTHORITY_SINCE`,
 * `VARIANCE_AUTHORITY_AT_DISTANCE` and `VARIANCE_AUTHORITY_GRAIN` for the
 * runner, and every worker the runner forks inherits them. The seam reads them where a configuration is wrapped,
 * and tests here wrap configurations, in their own process and in the Jest,
 * Vitest and rstest runs they start over fixtures. Left set, a test of the seam
 * would select from this checkout's record, and a fixture run would select
 * from a record that is not its own.
 *
 * The runner has read them by the time a worker loads this, so they are
 * removed from the worker's environment before any test file runs.
 */

delete process.env['VARIANCE_AUTHORITY_SINCE'];
delete process.env['VARIANCE_AUTHORITY_AT_DISTANCE'];
delete process.env['VARIANCE_AUTHORITY_GRAIN'];
