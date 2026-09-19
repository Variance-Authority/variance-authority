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
 * - a diff no part of which is in the graph — a lockfile, a build config, a
 *   `package.json`, every one of which can repaint the suite;
 * - a diff whose files reach no component at all — which is also exactly what a
 *   changed file declaring a component the scanner failed to recognise looks
 *   like.
 *
 * Each returns the reason instead of an answer. The caller that narrows widens to
 * the whole suite; the caller that reports prints the refusal where the
 * attribution would have been. Neither guesses.
 */

import {
  explain,
  movedBy,
  nodesOfKind,
  type Reached,
  type Relations,
} from '@variance-authority/core/relate';
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
 * The backwards walk and the two refusals that are about the *diff* rather than
 * about what the caller wanted out of it.
 *
 * Both callers below refuse the same two readings — a changed file the scan
 * should hold and does not, and a diff no part of which is in the graph — and
 * they are written here once. A tool that ruled a subject out on one reading
 * and printed a file list on the other would be two tools wearing one name,
 * which is the same argument that keeps the selector and the report on a single
 * walk.
 */
function seedsOf(
  relations: Relations,
  changed: readonly string[],
  changedDirs: readonly string[],
  roots: readonly string[],
): { readonly moved: Reached; readonly seeded: number } | GraphRefusal {
  const expanded =
    changedDirs.length === 0
      ? []
      : nodesOfKind(relations, 'file')
          .map((id) => relations.names[id]!)
          .filter((file) => within(file, changedDirs));

  const moved = movedBy(relations, [...changed, ...expanded]);
  // Only the diff's own paths can be missing; an expanded one came out of the
  // graph, so it is in it by construction.
  const seeded = changed.length - moved.missing.length + expanded.length;

  const unscanned = moved.missing.filter((file) => within(file, roots));
  if (unscanned.length > 0) {
    return {
      unscanned,
      whole:
        `${many(unscanned.length, 'changed file')} under the scanned roots ${unscanned.length === 1 ? 'is' : 'are'} ` +
        `not in the file graph (${sample(unscanned)}), so nothing here can say what they reach`,
    };
  }

  if (seeded === 0) {
    return {
      whole:
        `none of the ${many(changed.length, 'changed file')} is in the file graph, so this diff ` +
        'says nothing about what it reaches',
    };
  }

  return { moved, seeded };
}

/** What the file walk found, when it could answer. */
export interface FilesReach {
  /** Every file the diff reaches, the changed files among them, sorted. */
  readonly files: readonly string[];
  /** How many of the diff's own paths the graph actually holds. */
  readonly seeded: number;
  /** Files in the graph whose own edges could not be read. */
  readonly opaque: readonly ReachHole[];
  /** One sentence naming the size of the answer and what widened it. */
  readonly how: string;
}

/**
 * Every file a diff reaches, or a refusal — the answer a foreign runner is given.
 *
 * The same walk {@link componentsReached} makes, stopped one step earlier. It
 * has no third refusal of its own, and that is the property the command over it
 * rests on: *reaches no component* is a real thing a diff can do, while
 * *reaches no file* is not, because `movedBy` returns the seeds among the files
 * it reached. So an answer that gets past {@link seedsOf} holds at least the
 * changed files themselves, and a caller substituting this into a command line
 * can never be handed an empty list that means `run nothing`.
 */
export function filesReached(
  relations: Relations,
  changed: readonly string[],
  roots: readonly string[],
  changedDirs: readonly string[] = [],
): FilesReach | GraphRefusal {
  const walk = seedsOf(relations, changed, changedDirs, roots);
  if (refused(walk)) return walk;

  const { moved, seeded } = walk;
  const widened =
    moved.opaque.length === 0
      ? ''
      : `, ${moved.opaque.length} of them reached because their own imports could not be read ` +
        `(${sample(moved.opaque.map(holeOf))})`;

  return {
    files: [...moved.files].sort(byCodeUnit),
    seeded,
    opaque: moved.opaque,
    how: `${many(moved.files.length, 'file')} reached from ${many(seeded, 'changed file')}${widened}`,
  };
}

/**
 * Every component a diff reaches, or a refusal — the answer the report prints.
 *
 * {@link seedsOf}'s two refusals, and one of its own: a diff that reaches no
 * component at all. `changedDirs` is a monorepo tool's coarser answer — whole
 * packages `nx` or `turbo` called affected — and it enters as ordinary seeds
 * rather than as the selection, so the graph narrows outwards from them exactly
 * as it does from a file somebody edited.
 */
export function componentsReached(
  relations: Relations,
  changed: readonly string[],
  changedDirs: readonly string[],
  roots: readonly string[],
): GraphReach | GraphRefusal {
  const walk = seedsOf(relations, changed, changedDirs, roots);
  if (refused(walk)) return walk;

  const { moved, seeded } = walk;

  if (moved.components.length === 0) {
    return {
      whole:
        `the ${many(seeded, 'changed file')} in the graph reach no component, which is also what ` +
        'a changed file declaring a component the scan did not recognise looks like',
    };
  }

  // A seed the diff did not name. `movedBy` seeds every file whose imports could
  // not be read, because an unreadable file may import the one that changed —
  // sound for deciding what to observe, and an outright false attribution if a
  // trail opened with it unlabelled.
  const named = new Set(changed);
  const unread = (trail: readonly string[]): string | undefined => {
    const seed = trail[0];
    if (seed === undefined || named.has(seed) || within(seed, changedDirs)) return undefined;
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
      `${many(moved.components.length, 'component')} reached from ${many(seeded, 'changed file')} ` +
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
  const walk = componentsReached(relations, changed, input.changedDirs ?? [], roots);

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
