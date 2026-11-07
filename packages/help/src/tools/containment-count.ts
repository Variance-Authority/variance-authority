/**
 * What a line of commits touched across package boundaries, counted.
 *
 * Every figure is a count over a named denominator, and each is a different
 * question, so none is merged into a score: a share of commits says what was
 * touched together, and the commit never says why.
 *
 * A commit is counted when it changed source and is a person's single change.
 * What is left out is counted by the first reason that takes it: one commit
 * touching more than {@link WIDE} files is a sweep rather than a change, a bot's
 * and a revert's are not somebody deciding what belongs together, and a commit
 * with no source has no boundary to stay inside.
 */

// compass: variance-authority.report.agent-surface

import { packageOwner, type CommitChange } from '@variance-authority/sense';

/** A commit touching more files than this is left out as a sweep. */
export const WIDE = 300;

const BOT = /\[bot\]|renovate|dependabot/iu;
const REVERT = /^revert\b/iu;

const TEST = /\.(test|spec|cy|e2e)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|_spec\.rb$|Tests?\.(java|kt)$|(^|\/)(__tests__|tests?|spec|e2e|cypress|playwright|integration-tests?|test-e2e)\/.*\.(ts|tsx|js|jsx|mjs|py|go|rb|java|kt)$/iu;
const SOURCE = /\.(ts|tsx|js|jsx|mjs|vue|svelte|py|go|rb|java|kt|rs|php)$/u;
const NEITHER = /(^|\/)(fixtures?|__fixtures__|__snapshots__|__mocks__|snapshots|testdata|locales?|i18n|translations|dist|vendor|node_modules|generated|__generated__|migrations?)\/|\.(snap|d\.ts|lock|min\.js|gen\.go|pb\.go)$/iu;

/** A count and what it is out of. */
export interface Share {
  readonly count: number;
  readonly of: number;
}

/** The commits not counted, by the first reason that took each. */
export interface LeftOut {
  readonly wide: number;
  readonly bot: number;
  readonly revert: number;
  readonly noSource: number;
}

/** The figures, each over the commits it names. */
export interface ContainmentCount {
  /** Commits read from the line. */
  readonly read: number;
  /** Commits that changed source and were not left out. */
  readonly counted: number;
  readonly leftOut: LeftOut;
  /** Source in exactly one package, over the counted commits. */
  readonly onePackage: Share;
  /** A test in another package that holds source, over the counted commits. */
  readonly testInAnotherPackage: Share;
  /** A test outside the commit's packages and outside every package with source, over the counted commits. */
  readonly testOnlyTree: Share;
  /** A test in another package, over the commits that edited their own tests. */
  readonly anotherGivenOwnTests: Share;
  /** A test in another package, over the commits that did not. */
  readonly anotherGivenNoOwnTests: Share;
}

type Reason = keyof LeftOut;

function isTest(file: string): boolean {
  return TEST.test(file) && !NEITHER.test(file);
}

function isSource(file: string): boolean {
  return SOURCE.test(file) && !TEST.test(file) && !NEITHER.test(file);
}

function reasonToLeaveOut(commit: CommitChange): Reason | undefined {
  if (commit.files.length > WIDE) return 'wide';
  if (BOT.test(commit.author)) return 'bot';
  if (REVERT.test(commit.subject)) return 'revert';
  return commit.files.some(isSource) ? undefined : 'noSource';
}

/** Each commit's own packages, and where its tests fell, once the window's packages with source are known. */
interface Touched {
  readonly own: ReadonlySet<string>;
  readonly tests: ReadonlySet<string>;
}

/** Counts `commits`, with each path's package taken from `packages`. */
export function countContainment(commits: readonly CommitChange[], packages: readonly string[]): ContainmentCount {
  const ownerOf = packageOwner(packages);
  const leftOut = { wide: 0, bot: 0, revert: 0, noSource: 0 };
  const touched: Touched[] = [];
  for (const commit of commits) {
    const reason = reasonToLeaveOut(commit);
    if (reason !== undefined) {
      leftOut[reason] += 1;
      continue;
    }
    touched.push({
      own: new Set(commit.files.filter(isSource).map(ownerOf)),
      tests: new Set(commit.files.filter(isTest).map(ownerOf)),
    });
  }
  const withSource = new Set(touched.flatMap((commit) => [...commit.own]));
  const isPackage = (owner: string): boolean => owner !== '.' && withSource.has(owner);
  const foreign = (commit: Touched): readonly string[] => [...commit.tests].filter((owner) => !commit.own.has(owner));
  const inAnother = (commit: Touched): boolean => foreign(commit).some(isPackage);
  const inTree = (commit: Touched): boolean => foreign(commit).some((owner) => !isPackage(owner));
  const ownTests = (commit: Touched): boolean => [...commit.tests].some((owner) => commit.own.has(owner));
  const share = (over: readonly Touched[], holds: (commit: Touched) => boolean): Share => ({ count: over.filter(holds).length, of: over.length });
  return {
    read: commits.length,
    counted: touched.length,
    leftOut,
    onePackage: share(touched, (commit) => commit.own.size === 1),
    testInAnotherPackage: share(touched, inAnother),
    testOnlyTree: share(touched, inTree),
    anotherGivenOwnTests: share(touched.filter(ownTests), inAnother),
    anotherGivenNoOwnTests: share(touched.filter((commit) => !ownTests(commit)), inAnother),
  };
}
