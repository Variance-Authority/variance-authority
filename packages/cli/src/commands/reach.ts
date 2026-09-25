/**
 * What the commit reaches — the walk, and the report it produces.
 *
 * The graph traversal here has two callers with opposite purposes, which is the
 * reason it lives in its own file. [`affected.ts`](./affected.ts) uses it to
 * decide what *not* to observe, and throws the reasoning away the moment the skip
 * list is built. The report uses the reasoning itself: which components this diff
 * can possibly affect, and by which chain.
 *
 * They must not be two walks. A run that skipped a subject for one reason and
 * then printed another would be worse than one that printed nothing, because the
 * printed sentence is the one a reviewer would act on — so the refusals below
 * are written once, and the selector reads them out of the same call the report
 * does.
 *
 * ## The refusals are the design
 *
 * Three states look identical from inside a graph walk and mean entirely
 * different things:
 *
 * - a changed file under the scanned roots that the graph does not hold — a gap
 *   in the scan, not a file that affects nothing;
 * - a diff no part of which is in the graph — a build config, a CI workflow, a
 *   `tsconfig`, every one of which can repaint the suite;
 * - a diff whose files reach no component at all — which is also exactly what a
 *   changed file declaring a component the scanner failed to recognise looks
 *   like.
 *
 * Each returns the reason instead of an answer. The caller that narrows widens to
 * the whole suite; the caller that reports prints the refusal where the
 * attribution would have been. Neither guesses.
 *
 * ## The install is read, not counted as a changed file
 *
 * A lockfile used to belong in the second list, and it was the most expensive
 * entry there: every `yarn add` repainted the whole suite, because a file the
 * graph has no node for is a file nothing can say anything about. It is a node
 * now — several — and the diff of the install arrives here as `InstallDiff`:
 * the package **names** whose resolution changed, seeded into the same walk the
 * changed files are, and the manifest paths whose meaning that comparison has
 * already read. Those paths are then dropped from the seeds, because a lockfile
 * counted twice — once as the packages it resolved and once as an unknown file
 * — would widen for the very thing it just explained.
 *
 * A `package.json` is only half read by that comparison. Its `exports`, `main`
 * and `type` decide which file an importer of the package loads, and the
 * lockfile holds none of them, so a manifest whose change reaches them arrives
 * as `moved` and its package is walked as a changed directory.
 */

import {
  explain,
  changedBefore,
  affectedBy,
  nodesOfKind,
  within,
  type BeforeReach,
  type Affected,
  type Relations,
} from '@variance-authority/core/relate';
import type { ReachedComponent } from '@variance-authority/report';
import { movedPackages, NO_INSTALL_DIFF, withoutManifests, type InstallDiff } from './installed.js';

/** What the walk found, when it could answer. */
export interface AffectedComponents {
  /** Components the diff affects, sorted by name, each with its chain. */
  readonly components: readonly ReachedComponent[];
  /** Files the diff affects, including the seeds themselves. */
  readonly files: readonly string[];
  /** How many of the diff's own paths the graph actually holds. */
  readonly seeded: number;
  /** One sentence naming the size of the answer, for the selector to print. */
  readonly how: string;
}

/** Why the walk could not answer, and — when that is the reason — with what. */
export interface GraphRefusal {
  readonly whole: string;
  readonly unscanned?: readonly string[];
  /** The `source.before` files this diff moves, when that is the refusal. */
  readonly rests?: readonly string[];
}

/**
 * Whether the walk refused, whichever of its answers was asked for.
 *
 * Generic over the answer because the same refusals are returned by the
 * component walk, the file walk, and the shared seeding step between them, and
 * a caller that had to name which one it asked would be a caller that could
 * name the wrong one.
 */
export function refused<T extends object>(reach: T | GraphRefusal): reach is GraphRefusal {
  return 'whole' in reach;
}

/**
 * Per changed file read from both texts, the exports its importers see move.
 *
 * Empty is a file that runs what it ran before — a comment, a type, formatting
 * — and seeds nothing. A list narrows the walk to the importers that bind one of
 * those names, and carries them through a barrel under the names it republishes
 * them as. A changed file absent here was not read, or its load moved, and it
 * seeds the walk whole.
 */
export type MovedExports = ReadonlyMap<string, readonly string[]>;

/**
 * The walk, and what the two callers below need in order to say it in their own
 * words: how many seeds the graph held, and the phrase naming what the answer
 * was built from.
 */
interface Seeds {
  readonly affected: Affected;
  readonly seeded: number;
  /** `3 changed files and 1 changed package`, for whichever sentence prints. */
  readonly source: string;
}

/**
 * The diff affects nothing, and that is an answer rather than a gap.
 *
 * A diff of manifests where every package resolved to what it resolved before
 * or no file imports the ones that changed, and a diff of files that change
 * nothing that runs, produce it. The callers part here — a report says *no component is affected* and carries
 * the sentence, and a run list cannot, because an empty list on the far side of
 * an `xargs` runs nothing and reads as a fast green build.
 */
interface Nothing {
  readonly nothing: string;
}

function affectsNothing<T extends object>(walk: T | Nothing): walk is Nothing {
  return 'nothing' in walk;
}

/**
 * Walk the graph backwards from every changed file, or refuse and say why.
 *
 * `changedDirs` is a monorepo tool's coarser answer — whole packages `nx` or
 * `turbo` called affected — and it enters as ordinary seeds rather than as the
 * selection, so the graph narrows outwards from them exactly as it does from a
 * file somebody edited.
 *
 * `install` enters the same way, at the other end of the line: a package name is
 * a node, every file that imports it has an edge to it, and a bumped package is
 * a seed the walk runs backwards from exactly as it does from an edited file.
 * A package name the graph has no node for is not a gap — it is a dependency no
 * file in this repository asks for, and it reaches nothing.
 *
 * `movedExports` are what the changed files moved, read from both texts. A
 * file that moved nothing seeds nothing, and a diff of nothing else is the
 * answer *nothing*, as a diff of settled manifests is. A file that moved some
 * exports seeds a walk narrowed to their importers.
 *
 * `before` is the far-left end: what the harness rests on that nothing imports.
 * It is asked first and it does not narrow — a walk against the arrows from a
 * setup file the suite loads for every test reaches whatever happens to import
 * it, which is nothing, and answering *no component* there would skip the whole
 * suite over the file that governs it.
 *
 * Both callers below refuse the same readings — a changed file the scan should
 * hold and does not, and a diff no part of which is in the graph — and they are
 * written here once. A tool that ruled a subject out on one reading and printed
 * a file list on the other would be two tools wearing one name, which is the
 * same argument that keeps the selector and the report on a single walk.
 */
function seedsOf(
  relations: Relations,
  changed: readonly string[],
  changedDirs: readonly string[],
  roots: readonly string[],
  install: InstallDiff = NO_INSTALL_DIFF,
  before?: BeforeReach,
  movedExports: MovedExports = new Map(),
): Seeds | Nothing | GraphRefusal {
  if ('whole' in install) return { whole: install.whole };

  const moved = movedPackages(relations, install);
  const still = changed.filter((file) => movedExports.get(file)?.length === 0);
  const files = [
    ...withoutManifests(changed, install.manifests).filter((file) => !still.includes(file)),
    ...moved.unplaced,
  ];

  // Before anything is walked, and it refuses rather than narrows. A walk
  // against the arrows from a setup file the suite loads for every test reaches
  // whatever happens to import it, which is nothing, and answering *no
  // component* there would skip the whole suite over the file that governs it.
  const rests = before === undefined ? [] : [...changedBefore(before, files, install.packages)].sort(byCodeUnit);
  if (rests.length > 0) {
    const them = rests.length === 1 ? 'it' : 'them';
    return {
      whole:
        `the run rests on ${listed(rests)} before any test imports ${them}, and this diff moves ` +
        `${them}: nothing here has an edge to walk back from`,
      rests,
    };
  }

  const expanded = [
    ...new Set([
      ...(changedDirs.length === 0
        ? []
        : nodesOfKind(relations, 'file')
            .map((id) => relations.names[id]!)
            .filter((file) => within(file, changedDirs))),
      ...moved.files,
    ]),
  ];

  const packages = install.packages.map((name) => ({ kind: 'package', name }) as const);
  const narrowed = files.filter((file) => (movedExports.get(file)?.length ?? 0) > 0);
  const affected = affectedBy(
    relations,
    [...files, ...expanded, ...packages],
    narrowed.length === 0 ? {} : { moved: new Map(narrowed.map((file) => [file, movedExports.get(file)!])) },
  );
  // Only the diff's own seeds can be missing; an expanded one came out of the
  // graph, so it is in it by construction.
  const seeded = files.length + packages.length - affected.missing.length + expanded.length;

  // Files only. A missing *package* name is an answer — nothing imports it — and
  // `within` would not tell the two apart, since a package may be named anything.
  const named = new Set(files);
  const unscanned = affected.missing.filter((file) => named.has(file) && within(file, roots));

  // What the answer was built from, for the sentence the selector prints. The
  // two halves are counted apart because they are read from different places —
  // one from the diff, one from the lockfile at both revisions — and an
  // operator who cannot see which is which cannot check either.
  const absent = new Set(affected.missing);
  const fromPackages = install.packages.filter((name) => !absent.has(name)).length;
  const fromFiles = seeded - fromPackages;
  const source =
    (fromPackages === 0
      ? many(fromFiles, 'changed file')
      : fromFiles === 0
        ? many(fromPackages, 'changed package')
        : `${many(fromFiles, 'changed file')} and ${many(fromPackages, 'changed package')}`) +
    (still.length === 0 ? '' : ` (${ranAsBefore(still)})`) +
    (narrowed.length === 0 ? '' : ` (${byExport(narrowed, movedExports)})`);
  if (unscanned.length > 0) {
    return {
      unscanned,
      whole:
        `${many(unscanned.length, 'changed file')} under the scanned roots ${unscanned.length === 1 ? 'is' : 'are'} ` +
        `not in the file graph (${sample(unscanned)}), so nothing here can say what they reach`,
    };
  }

  if (seeded === 0) {
    // Nothing left but the install, and that is an answer rather than a gap:
    // every file that names a package has an edge to it, so *no file names this
    // one* is as complete as anything the walk ever says. The same holds one
    // step earlier — a lockfile rewritten by a workspace version bump resolves
    // every package to what it resolved before, and changed nothing.
    if (files.length === 0 && expanded.length === 0 && changed.length > 0) {
      const settled =
        install.packages.length > 0
          ? `no file imports ${listed([...install.packages].sort(byCodeUnit))}`
          : still.length === 0
            ? 'the diff changed only manifests, and the install resolves every package to what ' +
              'it resolved before'
            : 'the install resolves every package to what it resolved before';
      return {
        nothing:
          still.length === 0
            ? settled
            : still.length === changed.length
              ? ranAsBefore(still)
              : `${ranAsBefore(still)}, and ${settled}`,
      };
    }

    return {
      whole:
        `none of the ${many(files.length, 'changed file')} is in the file graph, so this diff ` +
        'says nothing about what it reaches',
    };
  }

  return { affected, seeded, source };
}

/** What the file walk found, when it could answer. */
export interface AffectedFiles {
  /** Every file the diff affects, the changed files among them, sorted. */
  readonly files: readonly string[];
  /** How many of the diff's own paths the graph actually holds. */
  readonly seeded: number;
  /** One sentence naming the size of the answer. */
  readonly how: string;
}

/**
 * Every file a diff affects, or a refusal — the answer a foreign runner is given.
 *
 * The same walk {@link affectedComponents} makes, stopped one step earlier. It
 * has no third refusal of its own, and that is the property the command over it
 * rests on: *affects no component* is a real thing a diff can do, while
 * *affects no file* is not, because `affectedBy` returns the seeds among the files
 * it affects. So an answer that gets past {@link seedsOf} holds at least the
 * changed files themselves, and a caller substituting this into a command line
 * can never be handed an empty list that means `run nothing`.
 */
export function affectedFiles(
  relations: Relations,
  changed: readonly string[],
  roots: readonly string[],
  changedDirs: readonly string[] = [],
  movedExports: MovedExports = new Map(),
): AffectedFiles | GraphRefusal {
  const walk = seedsOf(relations, changed, changedDirs, roots, NO_INSTALL_DIFF, undefined, movedExports);
  if (refused(walk)) return walk;
  // The one place this and the report disagree. There is a real answer here and
  // it is *nothing*, which a report can print and a run list cannot hand over.
  if (affectsNothing(walk)) return { whole: walk.nothing };

  const { affected, seeded, source } = walk;

  return {
    files: [...affected.files].sort(byCodeUnit),
    seeded,
    how: `${many(affected.files.length, 'file')} reached from ${source}`,
  };
}

/**
 * Every component a diff affects, or a refusal — the answer the report prints.
 *
 * {@link seedsOf}'s two refusals, and one of its own: a diff that reaches no
 * component at all. `changedDirs` is a monorepo tool's coarser answer — whole
 * packages `nx` or `turbo` called affected — and it enters as ordinary seeds
 * rather than as the selection, so the graph narrows outwards from them exactly
 * as it does from a file somebody edited.
 */
export function affectedComponents(
  relations: Relations,
  changed: readonly string[],
  changedDirs: readonly string[],
  roots: readonly string[],
  install: InstallDiff = NO_INSTALL_DIFF,
  before?: BeforeReach,
  movedExports: MovedExports = new Map(),
): AffectedComponents | GraphRefusal {
  const walk = seedsOf(relations, changed, changedDirs, roots, install, before, movedExports);
  if (refused(walk)) return walk;
  if (affectsNothing(walk)) {
    return { components: [], files: [], seeded: 0, how: walk.nothing };
  }

  const { affected, seeded, source } = walk;

  if (affected.components.length === 0) {
    return {
      whole:
        `the ${source} in the graph reach no component, which is also what a changed file ` +
        'declaring a component the scan did not recognise looks like',
    };
  }

  const components = [...affected.components].sort(byCodeUnit).map((component) => ({
    component,
    trail: explain(relations, affected, { kind: 'component', name: component }),
  }));

  return {
    components,
    files: affected.files,
    seeded,
    how:
      `${many(affected.components.length, 'component')} reached from ${source} ` +
      `through ${many(affected.files.length, 'file')}`,
  };
}

/**
 * `1 component`, `3 components` — never `3 component(s)`, which is storage.
 *
 * Exported because [`affected.ts`](./affected.ts) prints the other half of these
 * same sentences, and a run whose selector and whose report pluralise differently
 * reads as two tools that happened to agree.
 */
export function many(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/** The first three of a list, with a mark when there are more. */
function sample(files: readonly string[]): string {
  return `${files.slice(0, 3).join(', ')}${files.length > 3 ? ', …' : ''}`;
}

/** The clause naming the changed files that seeded nothing, and why. */
function ranAsBefore(files: readonly string[]): string {
  return `${listed(files)} ${files.length === 1 ? 'changes' : 'change'} nothing that runs, so ` +
    `${files.length === 1 ? 'it seeds' : 'they seed'} nothing`;
}

/** The clause naming the changed files that seeded only the importers of what they moved. */
function byExport(files: readonly string[], movedExports: MovedExports): string {
  const said = files.slice(0, 3).map((file) => `${file} changes ${movedExports.get(file)!.join(', ')}`);
  const more = files.length > 3 ? `; ${files.length - 3} more` : '';
  return `${said.join('; ')}${more}; only files that import a changed export are walked`;
}

/**
 * Up to three names in prose, and a count for the rest.
 *
 * Exported for [`reach-subjects.ts`](./reach-subjects.ts), which prints the
 * per-subject half of the same sentences.
 */
export function listed(names: readonly string[]): string {
  if (names.length <= 3) {
    const head = names.slice(0, -1).join(', ');
    return head === '' ? names[0]! : `${head} and ${names[names.length - 1]!}`;
  }
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether a changed path lies under one of the scanned roots.
 *
 * Re-exported rather than written again: the same boundary decides what the
 * harness walk stops at ([`before.ts`](../../../core/src/relate/before.ts)),
 * and two spellings of *is this path under that directory* would disagree the
 * day one of them was fixed.
 */
export { within };
