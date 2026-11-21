/**
 * What a line of commits touched across package boundaries, counted.
 *
 * Every figure is a count over a named denominator, and each is a different
 * question, so none is merged into a score: a share of commits says what was
 * touched together, and the commit never says why.
 *
 * A package is one the workspace lists that holds source now, whatever a window
 * changed, so a figure does not move with the window. A test-only tree is a
 * package or a top folder holding tests and no source. A commit is counted when a person changed source in a
 * package, and what is left out is counted by the first reason that takes it.
 */

// compass: variance-authority.report.agent-surface

import { CODE_EXTENSIONS, type CommitChange, type PathKind, type PathKinds } from '@variance-authority/sense';

const BOT = /\[bot\]|[-_ ]bot$|^(renovate|dependabot|github-actions)$/iu;

/** What counts as source: the code the index parses, and code it does not, which a commit changes all the same. */
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([...CODE_EXTENSIONS, '.go', '.rb', '.php', '.vue', '.svelte', '.cs', '.c', '.cc', '.cpp', '.h', '.scala']);

/** A count and what it is out of. */
export interface Share {
  readonly count: number;
  readonly of: number;
}

/** The commits not counted, by the first reason that took each. */
export interface LeftOut {
  /** A root or a shallow clone's oldest commit: its diff is the whole tree. */
  readonly noParent: number;
  readonly bot: number;
  readonly noSource: number;
  /** Source only outside every package that holds source. */
  readonly noPackage: number;
}

/** The figures, each over the commits it names. */
export interface ContainmentCount {
  /** Commits read from the line. */
  readonly read: number;
  /** Commits that changed source in a package. */
  readonly counted: number;
  readonly leftOut: LeftOut;
  /** Any file in exactly one package, over the counted commits. */
  readonly onePackage: Share;
  /** A test in another package that holds source, over the counted commits. */
  readonly testInAnotherPackage: Share;
  /** A test in a package or top folder that holds no source, over the counted commits. */
  readonly testOnlyTree: Share;
  /** A test in another package, over the commits that edited their own tests. */
  readonly anotherGivenOwnTests: Share;
  /** A test in another package, over the commits that did not. */
  readonly anotherGivenNoOwnTests: Share;
}

/** One counted commit: the packages it changed source in, every package it touched, and where its tests fell. */
interface Touched {
  readonly own: ReadonlySet<string>;
  readonly packages: ReadonlySet<string>;
  readonly tests: ReadonlySet<string>;
  readonly inTree: boolean;
}

/**
 * Counts `commits`, each path read by `kinds`, the rule the addon read
 * `holdingSource` by: which packages and top folders hold source now, a tree
 * holding a file with one of {@link SOURCE_EXTENSIONS} that is no test.
 */
export function countContainment(commits: readonly CommitChange[], holdingSource: ReadonlySet<string>, kinds: PathKinds): ContainmentCount {
  const isPackage = (owner: string): boolean => owner !== '.' && holdingSource.has(owner);
  const inTestOnlyTree = ({ tree }: PathKind): boolean => tree !== '.' && !holdingSource.has(tree);

  const leftOut = { noParent: 0, bot: 0, noSource: 0, noPackage: 0 };
  const touched: Touched[] = [];
  for (const commit of commits) {
    // A commit's own files, read by the addon a commit at a time.
    const files = kinds.of([...commit.files]);
    const source = files.filter((file) => file.source);
    const own = new Set(source.map((file) => file.owner).filter(isPackage));
    if (!commit.compared) leftOut.noParent += 1;
    else if (BOT.test(commit.author)) leftOut.bot += 1;
    else if (source.length === 0) leftOut.noSource += 1;
    else if (own.size === 0) leftOut.noPackage += 1;
    else {
      touched.push({
        own,
        packages: new Set(files.map((file) => file.owner).filter(isPackage)),
        tests: new Set(files.filter((file) => file.test).map((file) => file.owner)),
        inTree: files.some((file) => file.test && inTestOnlyTree(file)),
      });
    }
  }
  const inAnother = (commit: Touched): boolean => [...commit.tests].some((owner) => !commit.own.has(owner) && isPackage(owner));
  const ownTests = (commit: Touched): boolean => [...commit.tests].some((owner) => commit.own.has(owner));
  const share = (over: readonly Touched[], holds: (commit: Touched) => boolean): Share => ({ count: over.filter(holds).length, of: over.length });
  return {
    read: commits.length,
    counted: touched.length,
    leftOut,
    onePackage: share(touched, (commit) => commit.packages.size === 1),
    testInAnotherPackage: share(touched, inAnother),
    testOnlyTree: share(touched, (commit) => commit.inTree),
    anotherGivenOwnTests: share(touched.filter(ownTests), inAnother),
    anotherGivenNoOwnTests: share(touched.filter((commit) => !ownTests(commit)), inAnother),
  };
}
