import {
  indexSource,
  mergeSourceIndexes,
  movedBy,
  nodesOfKind,
  type Hole,
  type Relations,
  type SourceIndex,
} from '@variance-authority/core';

/**
 * Which subjects an edit could possibly have changed — and, far more carefully,
 * which ones it could not.
 *
 * The saving is the whole of it: a 300-subject suite where one component moved
 * pays for 300 collections and 300 comparisons to report two. Every product in
 * this category has an answer to that, and every one of them derives it from a
 * **bundler dependency graph** — which is a second build to configure, a stats
 * file to keep, and a graph that describes what could be imported rather than
 * what was rendered.
 *
 * This derives it from the baselines instead. A stored baseline records the
 * components the document that painted it actually rendered
 * ([ADR-0018](../../../../docs/context/adr/0018-a-component-hash-covers-its-own-nodes.md),
 * [ADR-0027](../../../../docs/context/adr/0027-a-baseline-carries-what-its-document-said.md)),
 * so *what this subject is made of* is a fact the last run established rather
 * than one a build tool predicts. It needs no plugin, no stats file and no
 * second graph.
 *
 * ## Everything here is arranged to over-include
 *
 * A selector that skips a subject it should have observed produces a green run
 * over an unwatched surface, which is the failure this project exists to refuse —
 * and it produces it *silently*, because the subject is not in the report to be
 * missing from. A selector that observes a subject it need not have merely costs
 * a collection. Those are not symmetric, so every uncertainty below resolves the
 * same way:
 *
 * - a subject with **no baseline** is observed — it is new, and nothing is known;
 * - a subject whose baseline records **no component list** is observed — absent is
 *   unknown, never *renders nothing*;
 * - a changed source file that declares **no component** makes the whole run
 *   whole — it can be a stylesheet, a token file, a helper every component
 *   imports, and none of those name themselves in any subject;
 * - a run that cannot list its changed files at all does not narrow.
 *
 * The last three are reported, not assumed. A run that quietly declined to narrow
 * would look like a selector that decided nothing was affected, and those are
 * opposite facts.
 *
 * ## The third bullet is the expensive one, and a graph retires it
 *
 * `src/tokens.css` declares nothing, so the rule above runs three hundred
 * subjects to report two. Give this a `relations` graph — a file-to-file
 * structure somebody scanned, or one `nx` and `turbo` already hold — and the
 * question changes from *what does this file declare* to **what reaches this
 * file**: `tokens.css` ← `button.css` ← `Button.tsx` ← `Button`.
 *
 * The over-inclusion arrangement survives it intact. A changed file the graph
 * never saw still makes the run whole, a file whose own imports could not be
 * read is traversed as though it changed, and a diff that reaches no component at
 * all is still refused rather than narrowed to nothing — because a component the
 * scanner failed to recognise is declared in a file that reaches nothing either,
 * and those two look identical from here.
 */

export interface AffectedInput {
  /** Every subject the run planned, by id. */
  readonly planned: readonly string[];

  /** Repository-relative paths the diff named. */
  readonly changed: readonly string[];

  /**
   * Directories whose every file counts as changed, from a monorepo tool's
   * affected-project answer.
   *
   * Coarser than a file list on purpose. `nx` and `turbo` see the one edge a
   * specifier scan cannot — one workspace package importing another's built
   * output — and the price of that edge is project granularity. It is taken as
   * *more changed input*, never as the selection itself.
   */
  readonly changedDirs?: readonly string[];

  /**
   * The component index built from the source that shipped, and the roots it was
   * built from.
   *
   * The roots matter as much as the index. A changed file *inside* them that
   * declares no component is a file this scan understands and found nothing in —
   * a stylesheet, a helper — and it forces a whole run. A changed file *outside*
   * them is a file nobody claimed could affect a render, and narrowing past it is
   * the operator's own declaration of where their components live.
   */
  readonly source: SourceIndex;
  readonly roots: readonly string[];

  /**
   * Component names each planned subject's stored baseline recorded.
   *
   * `undefined` for a subject with no baseline, and for one whose baseline
   * predates the field. Both mean *unknown*, and both are observed.
   */
  readonly baselines: ReadonlyMap<string, readonly string[] | undefined>;

  /**
   * The file graph, when one was built.
   *
   * Absent is the declaration-only selector, which is what a repository with no
   * scanner configured gets and is why this is optional rather than required.
   * Present replaces *what does this file declare* with *what reaches it* — and
   * changes nothing about which uncertainties refuse to narrow.
   */
  readonly relations?: Relations;
}

export interface Affected {
  /** Subjects to observe. Always a superset of what could have changed. */
  readonly observe: readonly string[];

  /** Subjects provably untouched by this diff, with the sentence that says so. */
  readonly skipped: readonly { readonly subject: string; readonly because: string }[];

  /**
   * Why the run was not narrowed, when it was not.
   *
   * Present means every subject is in `observe` — and the reason is printed
   * rather than swallowed, because "we could not narrow" and "nothing needed
   * narrowing" produce the same run and mean opposite things about the next one.
   */
  readonly whole?: string;

  /** One sentence for the report, whichever way it went. */
  readonly because: string;
}

/**
 * Decide what to observe from a diff, an index and the baselines.
 *
 * Pure, and takes its three inputs as values: the git call, the directory walk
 * and the store lookups are the caller's, which is what makes every rule above
 * assertable without a repository, a filesystem or a browser.
 */
export function affectedSubjects(input: AffectedInput): Affected {
  const { planned, changed, source, roots, baselines, relations } = input;
  const changedDirs = input.changedDirs ?? [];

  const everything = (whole: string): Affected => ({
    observe: planned,
    skipped: [],
    whole,
    because: `every subject was observed: ${whole}`,
  });

  if (changed.length === 0 && changedDirs.length === 0) {
    // Not an empty selection. A diff naming nothing is a run against a tree that
    // has not moved, and answering it with "observe nothing" would report a clean
    // suite that looked at none of it.
    return everything('the diff named no changed file, so nothing could be ruled out');
  }

  const narrowing =
    relations === undefined
      ? byDeclaration(changed, changedDirs, source, roots)
      : byRelation(changed, changedDirs, relations, roots);

  if ('whole' in narrowing) return everything(narrowing.whole);
  const { touched, how } = narrowing;

  const observe: string[] = [];
  const skipped: { subject: string; because: string }[] = [];

  for (const subject of planned) {
    const components = baselines.get(subject);

    if (components === undefined) {
      observe.push(subject);
      continue;
    }

    if (components.some((component) => touched.has(component))) {
      observe.push(subject);
      continue;
    }

    skipped.push({
      subject,
      because:
        `its baseline records ${components.length} component(s) and this diff touched none of ` +
        `them (${[...touched].slice(0, 3).join(', ')}${touched.size > 3 ? ', …' : ''})`,
    });
  }

  return {
    observe,
    skipped,
    because:
      `${observe.length} of ${planned.length} subject(s) observed: ${how}, and the rest of the ` +
      'suite records none of them',
  };
}

/**
 * A set of components a diff could have moved, or the reason it produced none.
 *
 * Two shapes rather than an empty set, because an empty set is the one answer
 * that must never reach the subject loop: it would skip every subject in the
 * suite, and the sentence explaining why is the only thing separating *this diff
 * moved nothing* from *this diff was not understood*.
 */
type Narrowing =
  | { readonly touched: ReadonlySet<string>; readonly how: string }
  | { readonly whole: string };

/**
 * What a diff moved, from the component index alone.
 *
 * The selector a repository with no scanner gets. It can answer only about files
 * it has attributed a component to, so anything else under the roots — the
 * stylesheet, the token file, the shared helper — makes the run whole.
 */
function byDeclaration(
  changed: readonly string[],
  changedDirs: readonly string[],
  source: SourceIndex,
  roots: readonly string[],
): Narrowing {
  const inside = changed.filter((file) => within(file, roots));
  const declaring = declaringFiles(source);

  const undeclared = inside.filter((file) => !declaring.has(file));
  if (undeclared.length > 0) {
    return {
      whole:
        `${undeclared.length} changed file(s) under the scanned roots declare no component ` +
        `(${sample(undeclared)}), and a stylesheet, a token file or a shared helper can move ` +
        'any subject without naming itself in one',
    };
  }

  // A project directory does not get the rule above. It is a whole package the
  // tool called affected, not a file somebody edited, and every package contains
  // files that declare no component — applying the rule would make any answer
  // from `nx` or `turbo` force a whole run, every time.
  const touched = new Set<string>();
  for (const [name, refs] of Object.entries(source)) {
    const moved = refs.some(
      (ref) => inside.includes(ref.file) || within(ref.file, changedDirs),
    );
    if (moved) touched.add(name);
  }

  if (touched.size === 0) {
    return {
      whole:
        `none of the ${changed.length} changed file(s) is under the scanned roots, so this diff ` +
        'says nothing about which components moved',
    };
  }

  return {
    touched,
    how: `${touched.size} component(s) moved in ${inside.length} changed file(s)`,
  };
}

/**
 * What a diff moved, by walking the graph backwards from every changed file.
 *
 * Three refusals, and each one is a place the graph is being honest about the
 * limit of what it holds rather than answering anyway.
 *
 * A changed file **under the roots that the scan never read** makes the run
 * whole: the roots are the operator's own statement of where renders come from,
 * so a file inside them the graph cannot place is a gap in the scan, not a file
 * that affects nothing.
 *
 * A diff **entirely outside the graph** makes it whole. A lockfile, a
 * `package.json`, a build config: none is a node here, and every one of them can
 * repaint the entire suite.
 *
 * A diff that reaches **no component** makes it whole, which is the subtle one.
 * A changed file genuinely affecting nothing and a changed file declaring a
 * component the scanner did not recognise produce exactly the same empty answer,
 * and only one of them is safe to act on.
 */
function byRelation(
  changed: readonly string[],
  changedDirs: readonly string[],
  relations: Relations,
  roots: readonly string[],
): Narrowing {
  // A project directory expands to the graph's own files under it, so a coarse
  // answer from `nx` or `turbo` enters the traversal as ordinary seeds and the
  // graph narrows outwards from them like it does from any other change.
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
      whole:
        `${unscanned.length} changed file(s) under the scanned roots are not in the file graph ` +
        `(${sample(unscanned)}), so nothing here can say what they reach`,
    };
  }

  if (seeded === 0) {
    return {
      whole:
        `none of the ${changed.length} changed file(s) is in the file graph, so this diff says ` +
        'nothing about which components moved',
    };
  }

  if (moved.components.length === 0) {
    return {
      whole:
        `the ${seeded} changed file(s) in the graph reach no component, which is also what a ` +
        'changed file declaring a component the scan did not recognise looks like',
    };
  }

  // Named with their reasons, not counted. This is the only line in the run that
  // tells an operator which file to fix in order to make the next run smaller,
  // and a bare number tells them there is nothing to be done.
  const widened =
    moved.opaque.length === 0
      ? ''
      : `, ${moved.opaque.length} of them traversed as changed because their own imports could ` +
        `not be read (${sample(moved.opaque.map(holeOf))})`;

  return {
    touched: new Set(moved.components),
    how:
      `${moved.components.length} component(s) reached from ${seeded} changed file(s) through ` +
      `${moved.files.length} file(s)${widened}`,
  };
}

/** The first three of a list, with a mark when there are more. */
function sample(files: readonly string[]): string {
  return `${files.slice(0, 3).join(', ')}${files.length > 3 ? ', …' : ''}`;
}

function holeOf(hole: Hole): string {
  return hole.because === undefined ? hole.file : `${hole.file}: ${hole.because}`;
}

/** Every file the index attributes at least one component to. */
function declaringFiles(source: SourceIndex): ReadonlySet<string> {
  const files = new Set<string>();
  for (const refs of Object.values(source)) {
    for (const ref of refs) files.add(ref.file);
  }
  return files;
}

/**
 * Whether a changed path lies under one of the scanned roots.
 *
 * A prefix match on directory boundaries rather than on characters: `src` must
 * not claim `srcery/`, or a diff in an unrelated directory would force whole runs
 * forever and the operator would never find out why.
 */
function within(file: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const normalized = root.replace(/\/+$/, '');
    return normalized === '.' || file === normalized || file.startsWith(`${normalized}/`);
  });
}

/**
 * Build the component index from files the caller has already read.
 *
 * Takes contents rather than paths for the same reason `affectedSubjects` takes
 * values: the walk belongs to whoever owns the disk, and the rule — how a file
 * becomes an index — has one owner in `core`.
 */
export function indexOf(files: ReadonlyMap<string, string>): SourceIndex {
  return mergeSourceIndexes(
    [...files.entries()].map(([file, contents]) => indexSource(file, contents)),
  );
}
