/**
 * What a path says of a file: whether it is named as a test, and whether it
 * sits with the tests. A name holds in any language; a directory holds its
 * fixtures and snapshots too, because a test is edited with them.
 *
 * The addon's `TEST_BY_PATH` is a second reading of the same question, for
 * `orient`: a path regex in Rust, which also takes a harness's config name.
 */

// compass: variance-authority.reach

const NAMED = /\.(test|spec|cy|e2e|stories|story)\.[cm]?[jt]sx?$|_test\.(go|py|[cm]?[jt]sx?)$|(^|\/)test_[^/]+\.py$|_spec\.rb$|[a-z0-9]Tests?\.(java|kt)$/u;

const WITH_THE_TESTS = /(^|\/)(__tests?__|__mocks__|__fixtures?__|__snapshots__|__stories__|\.storybook|fixtures|testdata|tests?|e2e|cypress)\//iu;

/**
 * Whether `file` is a test or sits with them. Read a path inside a package from
 * that package, so a package named `test` is not its own test.
 */
export function isTestPath(file: string): boolean {
  return NAMED.test(file) || WITH_THE_TESTS.test(file);
}
