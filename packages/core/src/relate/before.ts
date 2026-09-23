/**
 * What a run rests on that nothing in it imports.
 *
 * Selection walks one line. It starts at the test harness, moves right through
 * the tests into the repository's own files, and goes out past them into the
 * dependencies ([`records.ts`](./records.ts) holds all three as nodes). Every
 * question it asks is asked *against* the arrows: what depends on the thing
 * that changed.
 *
 * The far-left end of that line answers no such question. A `vitest.config.ts`,
 * a `jest.config.js`, a Next.js setup, a CI workflow, the Node version in a
 * `.nvmrc`: nothing imports them, so nothing has an edge to them, so a walk
 * from one reaches nothing and a walk to one arrives never. They are *before
 * reach* — able to repaint the whole suite and invisible to the only mechanism
 * that could say so.
 *
 * ## Why the accident is not enough
 *
 * A diff that names only such a file already runs everything, because a diff no
 * part of which is in the graph is refused. That holds only while it is the
 * *whole* diff. A CI workflow edited beside one component file is a diff with a
 * seed in it, and the walk from that seed answers confidently for a change it
 * never looked at. The widening was a side effect of having nothing to say, and
 * a side effect stops the moment somebody else has something to say.
 *
 * ## Why the operator names them
 *
 * Because no rule can. *Every changed path the graph does not hold* is the
 * README, the changelog, the fixture JSON, the editor settings: a whole run
 * each, forever, and an operator who turns that off has turned off the config
 * files too. Which paths govern a run is a fact about the repository that only
 * the repository knows, so it is declared — and once declared it is exact,
 * where a heuristic would be both too wide and too narrow on the same diff.
 *
 * ## What declaring one buys beyond its own name
 *
 * Everything below it. A `setup.ts` the config loads, a fixture module only
 * that setup imports, a polyfill, the environment package it names: each is an
 * ordinary file the scan already holds, that nothing imports, whose change
 * reaches no component and narrows the run to nothing. Declared, the entry
 * point is walked *along* the arrows once and that whole set comes with it.
 *
 * ## Where the descent stops
 *
 * At the first file the scan can already reason about. A setup file that
 * imports `src/theme.ts` does not drag `src/theme.ts` in with it: that file has
 * dependents, a change to it is answered exactly by walking them, and pulling
 * it into the harness would trade an exact answer for a whole run — the one
 * direction this is not allowed to be wrong in. The walk avoids sensed files,
 * and avoiding a node stops the walk there rather than stepping over it: what
 * lies below a sensed file is imported *through* it, and it already answers.
 *
 * ## Where the two ends meet
 *
 * The same walk carries into the package layer, and that is the whole of the
 * mixed case. A config imports `jest-environment-jsdom`, which rests on
 * `jsdom`; `jsdom` is bumped; the install comparison names it. It is a package
 * the harness reaches, so the run does not narrow — and no file in the
 * repository ever wrote the word. A change beyond reach, arriving before it.
 *
 * That cost is real and is the operator's to spend: a config that imports a
 * bundler reaches everything the bundler rests on, so a bump inside that set
 * widens. It is the correct answer — the harness did change — and a repository
 * that finds it too wide narrows what it declares rather than what this
 * concludes.
 */

import { nodeAt, type NodeId, type Relations } from './graph.js';
import { dependenciesOf } from './reach.js';

/** The part of a run that sits before the tests, as names. */
export interface BeforeReach {
  /**
   * The entry points as they were declared, matched against a diff by path.
   *
   * Kept apart from what they reach because they are matched differently: a
   * declared path claims everything under it, so a directory of workflows is
   * one entry, while a file the walk found is one file.
   */
  readonly entries: readonly string[];
  /** Files below the entry points that the scan does not otherwise sense. */
  readonly files: ReadonlySet<string>;
  /** Packages they rest on, direct and transitive. */
  readonly packages: ReadonlySet<string>;
  /**
   * Declared entry points the graph does not hold, and so has no closure for.
   *
   * Ordinary for most of them: a `.nvmrc`, a CI workflow and a `tsconfig` have
   * nothing below them a scan could read, and they contribute their own name,
   * which is all they have. Not ordinary for a config the scan should have
   * read, where it means the closure that would have come with it — the setup
   * module, the environment — is missing and those files still narrow to
   * nothing. The two are indistinguishable from here, so both are reported and
   * neither is guessed at.
   */
  readonly unread: readonly string[];
}

export interface BeforeReachOptions {
  /**
   * Files the scan already answers for, as the directories they live under.
   *
   * The descent stops at these. Absent, nothing stops it, and one setup import
   * into `src/` would put the repository's own source before reach.
   */
  readonly sensed?: readonly string[];
}

/**
 * Walk down from each declared entry point, stopping where the scan takes over.
 *
 * Along the arrows, unlike every other walk here, because this is the one
 * question whose subject has no dependents: *what does the harness rest on*.
 * Type-only edges are not walked — a config's `import type` is erased before
 * the suite runs, exactly as a component's is.
 */
export function beforeReach(
  relations: Relations,
  entries: readonly string[],
  options: BeforeReachOptions = {},
): BeforeReach {
  const files = new Set<string>();
  const packages = new Set<string>();
  const unread: string[] = [];
  if (entries.length === 0) return { entries, files, packages, unread };

  const sensed = options.sensed ?? [];
  const held = new Map<string, NodeId>();
  for (let id = 0; id < relations.names.length; id += 1) {
    const node = nodeAt(relations, id);
    if (node?.kind === 'file') held.set(node.name, id);
  }

  const seeds: NodeId[] = [];
  for (const entry of entries) {
    const id = held.get(entry);
    if (id === undefined) unread.push(entry);
    else seeds.push(id);
  }
  if (seeds.length === 0) return { entries, files, packages, unread };

  // Avoided before the walk rather than filtered after it. A sensed file is not
  // a step on the way to something else here: whatever it imports, it imports
  // as a file the scan holds, and the dependents of *that* file are the exact
  // answer the harness would have replaced with a whole run.
  const entered = new Set(seeds);
  const avoid: NodeId[] = [];
  for (const [name, id] of held) {
    if (!entered.has(id) && within(name, sensed)) avoid.push(id);
  }

  for (const id of dependenciesOf(relations, seeds, { avoid }).nodes) {
    const node = nodeAt(relations, id);
    if (node === undefined) continue;
    if (node.kind === 'file') files.add(node.name);
    else if (node.kind === 'package') packages.add(node.name);
  }

  return { entries, files, packages, unread };
}

/**
 * Which of a diff's own inputs the harness rests on, as they were named.
 *
 * Files and packages together and in that order, because the caller's next act
 * is to print them in one sentence and a reader does not care which list a name
 * came out of. Empty is a real answer: the diff changed nothing the run rests on.
 *
 * A declared entry claims every path under it, so naming a directory of
 * workflows is one line of configuration rather than one per file. A file the
 * walk found claims only itself: the walk visited it, so it is known exactly, and
 * widening it to its directory would put its neighbours before reach without
 * anybody saying they were.
 */
export function changedBefore(
  before: BeforeReach,
  changed: readonly string[],
  packages: readonly string[] = [],
): readonly string[] {
  return [
    ...changed.filter((file) => before.files.has(file) || within(file, before.entries)),
    ...packages.filter((name) => before.packages.has(name)),
  ];
}

/**
 * Whether a path lies under one of these directories.
 *
 * On directory boundaries rather than characters: `src` must not claim
 * `srcery/`, or a repository would put half of itself before reach and find out
 * from the runs that never narrowed. Exported because every caller that draws
 * this boundary over paths draws the same one, and two spellings of it would
 * disagree on the day one of them was fixed.
 */
export function within(file: string, dirs: readonly string[]): boolean {
  return dirs.some((dir) => {
    const normalized = dir.replace(/\/+$/, '');
    return normalized === '.' || file === normalized || file.startsWith(`${normalized}/`);
  });
}
