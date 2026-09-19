/**
 * What the commit reaches — the walk, and the report it produces.
 *
 * The graph traversal here has two callers with opposite purposes, which is the
 * reason it lives in its own file. [`affected.ts`](./affected.ts) uses it to
 * decide what *not* to observe, and throws the reasoning away the moment the skip
 * list is built. The report uses the reasoning itself: which components this diff
 * can possibly have moved, and by which chain.
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
 * the package **names** whose resolution moved, seeded into the same walk the
 * changed files are, and the manifest paths whose meaning that comparison has
 * already read. Those paths are then dropped from the seeds, because a lockfile
 * counted twice — once as the packages it resolved and once as an unknown file
 * — would widen for the very thing it just explained.
 */

import { explain, movedBy, nodesOfKind, type Relations } from '@variance-authority/core/relate';
import type { ReachHole, ReachReport, ReachedComponent, SubjectReach } from '@variance-authority/report';

/** What the walk found, when it could answer. */
export interface GraphReach {
  /** Components the diff reaches, sorted by name, each with its chain. */
  readonly components: readonly ReachedComponent[];
  /** Files the diff reaches, including the seeds themselves. */
  readonly files: readonly string[];
  /** How many of the diff's own paths the graph actually holds. */
  readonly seeded: number;
  /** Files in the graph whose own edges could not be read. */
  readonly opaque: readonly ReachHole[];
  /** One sentence naming the size of the answer, for the selector to print. */
  readonly how: string;
}

/** Why the walk could not answer, and — when that is the reason — with what. */
export interface GraphRefusal {
  readonly whole: string;
  readonly unscanned?: readonly string[];
}

export function refused(reach: GraphReach | GraphRefusal): reach is GraphRefusal {
  return 'whole' in reach;
}

/**
 * What a diff did to the install — the far-right end of the same line.
 *
 * A read of the lockfile at both revisions, collapsed to package names, or the
 * sentence saying the comparison could not be made. Never a list of changed
 * lockfile paths: which bytes of a lockfile moved says nothing (a workspace
 * version bump rewrites it and installs nothing), and which package names
 * resolved differently says everything.
 *
 * `manifests` are the *file names* that comparison speaks for — the lockfile's
 * own, and `package.json`, whose text can differ for reasons no install shares
 * and whose installed meaning is exactly what was just read. A walk drops them
 * from its seeds; anything else in the diff is still a changed file.
 */
export type InstallDiff =
  | { readonly packages: readonly string[]; readonly manifests: readonly string[] }
  | { readonly whole: string };

/** The install as *nothing happened*, for a caller that has no reading to offer. */
export const NO_INSTALL_DIFF: InstallDiff = { packages: [], manifests: [] };

/**
 * Paths the install comparison has already spoken for.
 *
 * Matched on the last segment, so a monorepo's every `package.json` goes the
 * same way the root one does: a resolver, a `resolutions` block, a version
 * range — the install answered all three, at both revisions, by name.
 */
export function withoutManifests(
  changed: readonly string[],
  manifests: readonly string[],
): readonly string[] {
  return changed.filter(
    (file) => !manifests.some((name) => file === name || file.endsWith(`/${name}`)),
  );
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
 */
export function componentsReached(
  relations: Relations,
  changed: readonly string[],
  changedDirs: readonly string[],
  roots: readonly string[],
  install: InstallDiff = NO_INSTALL_DIFF,
): GraphReach | GraphRefusal {
  if ('whole' in install) return { whole: install.whole };

  const files = withoutManifests(changed, install.manifests);
  const expanded =
    changedDirs.length === 0
      ? []
      : nodesOfKind(relations, 'file')
          .map((id) => relations.names[id]!)
          .filter((file) => within(file, changedDirs));

  const packages = install.packages.map((name) => ({ kind: 'package', name }) as const);
  const moved = movedBy(relations, [...files, ...expanded, ...packages]);
  // Only the diff's own seeds can be missing; an expanded one came out of the
  // graph, so it is in it by construction.
  const seeded = files.length + packages.length - moved.missing.length + expanded.length;

  // Files only. A missing *package* name is an answer — nothing imports it — and
  // `within` would not tell the two apart, since a package may be named anything.
  const named = new Set(files);
  const unscanned = moved.missing.filter((file) => named.has(file) && within(file, roots));

  // What the answer was built from, for the sentence the selector prints. The
  // two halves are counted apart because they are read from different places —
  // one from the diff, one from the lockfile at both revisions — and an
  // operator who cannot see which is which cannot check either.
  const absent = new Set(moved.missing);
  const fromPackages = install.packages.filter((name) => !absent.has(name)).length;
  const fromFiles = seeded - fromPackages;
  const source =
    fromPackages === 0
      ? many(fromFiles, 'changed file')
      : fromFiles === 0
        ? many(fromPackages, 'changed package')
        : `${many(fromFiles, 'changed file')} and ${many(fromPackages, 'changed package')}`;
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
    // every package to what it resolved before, and moved nothing.
    if (files.length === 0 && expanded.length === 0 && changed.length > 0) {
      return {
        components: [],
        files: [],
        seeded,
        opaque: [],
        how:
          install.packages.length === 0
            ? 'the diff changed only manifests, and the install resolves every package to what ' +
              'it resolved before'
            : `no file imports ${listed([...install.packages].sort(byCodeUnit))}`,
      };
    }

    return {
      whole:
        `none of the ${many(files.length, 'changed file')} is in the file graph, so this diff ` +
        'says nothing about which components moved',
    };
  }

  if (moved.components.length === 0) {
    return {
      whole:
        `the ${source} in the graph reach no component, which is also what a changed file ` +
        'declaring a component the scan did not recognise looks like',
    };
  }

  // A seed the diff did not name. `movedBy` seeds every file whose imports could
  // not be read, because an unreadable file may import the one that changed —
  // sound for deciding what to observe, and an outright false attribution if a
  // trail opened with it unlabelled. A package the install moved is named, and a
  // trail opening with it is the whole point of reading the lockfile.
  const seeds = new Set([...files, ...install.packages]);
  const unread = (trail: readonly string[]): string | undefined => {
    const seed = trail[0];
    if (seed === undefined || seeds.has(seed) || within(seed, changedDirs)) return undefined;
    return seed;
  };

  const components = [...moved.components].sort(byCodeUnit).map((component) => {
    const trail = explain(relations, moved, { kind: 'component', name: component });
    const seed = unread(trail);
    return { component, trail, ...(seed === undefined ? {} : { throughUnread: seed }) };
  });

  // Named with their reasons, not counted. This is the only line in the run that
  // tells an operator which file to fix in order to make the next run smaller,
  // and a bare number tells them there is nothing to be done.
  const widened =
    moved.opaque.length === 0
      ? ''
      : `, ${moved.opaque.length} of them traversed as changed because their own imports could ` +
        `not be read (${sample(moved.opaque.map(holeOf))})`;

  return {
    components,
    files: moved.files,
    seeded,
    opaque: moved.opaque,
    how:
      `${many(moved.components.length, 'component')} reached from ${source} ` +
      `through ${many(moved.files.length, 'file')}${widened}`,
  };
}

export interface ReachInput {
  /** The ref the diff was taken against, in the operator's own words. */
  readonly against: string;
  readonly changed: readonly string[];
  readonly changedDirs?: readonly string[];
  readonly relations: Relations;
  readonly roots: readonly string[];

  /**
   * What the diff did to the install, when the lockfile could be read at both
   * revisions. Absent is *no reading was taken*, which seeds no package and
   * leaves every manifest in the diff a changed file, exactly as before.
   */
  readonly install?: InstallDiff;

  /**
   * Component names each planned subject's stored baseline recorded.
   *
   * `undefined` for a subject with no baseline, and for one whose baseline
   * predates the field. Neither is a key in the answer: the run does not know
   * what that subject is made of, so it cannot say what reaches it, and a
   * `reached: false` written from an absent list would be an assertion nobody
   * made.
   */
  readonly baselines: ReadonlyMap<string, readonly string[] | undefined>;
}

/**
 * The reach section of the report: the walk, joined to what each baseline said
 * its subject was made of.
 *
 * The join is the point. A graph alone says which components an edit reaches,
 * which is a fact about source. A baseline alone says which components a subject
 * rendered, which is a fact about a browser. Only together do they say whether
 * this commit could have moved this picture — and that is the sentence that makes
 * a green subject and a red one interesting for opposite reasons.
 */
export function reachOf(input: ReachInput): ReachReport {
  const { against, changed, relations, roots, baselines } = input;
  const walk = componentsReached(
    relations,
    changed,
    input.changedDirs ?? [],
    roots,
    input.install ?? NO_INSTALL_DIFF,
  );

  if (refused(walk)) {
    return {
      against,
      changed,
      components: [],
      whole: walk.whole,
      ...(walk.unscanned === undefined ? {} : { unscanned: walk.unscanned }),
    };
  }

  const trails = new Map(walk.components.map((entry) => [entry.component, entry.trail]));
  const subjects: Record<string, SubjectReach> = {};

  for (const [subject, components] of baselines) {
    if (components === undefined) continue;

    const through = components.filter((component) => trails.has(component)).sort(byCodeUnit);
    const first = through[0];

    if (first === undefined) {
      subjects[subject] = {
        reached: false,
        through: [],
        because:
          `its baseline records ${many(components.length, 'component')} and this diff reaches ` +
          'none of them',
      };
      continue;
    }

    subjects[subject] = {
      reached: true,
      through,
      trail: trails.get(first)!,
      because:
        `this diff reaches ${listed(through)}, which its baseline records among ` +
        `${many(components.length, 'component')}`,
    };
  }

  return {
    against,
    changed,
    components: walk.components,
    subjects,
    ...(walk.opaque.length === 0 ? {} : { opaque: walk.opaque }),
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

/** Up to three names in prose, and a count for the rest. */
function listed(names: readonly string[]): string {
  if (names.length <= 3) {
    const head = names.slice(0, -1).join(', ');
    return head === '' ? names[0]! : `${head} and ${names[names.length - 1]!}`;
  }
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

function holeOf(hole: ReachHole): string {
  return hole.because === undefined ? hole.file : `${hole.file}: ${hole.because}`;
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Whether a changed path lies under one of the scanned roots.
 *
 * A prefix match on directory boundaries rather than on characters: `src` must
 * not claim `srcery/`, or a diff in an unrelated directory would force whole runs
 * forever and the operator would never find out why.
 */
export function within(file: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const normalized = root.replace(/\/+$/, '');
    return normalized === '.' || file === normalized || file.startsWith(`${normalized}/`);
  });
}
