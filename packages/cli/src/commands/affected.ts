import { indexSource, mergeSourceIndexes, type SourceIndex } from '@variance-authority/core';

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
 */

export interface AffectedInput {
  /** Every subject the run planned, by id. */
  readonly planned: readonly string[];

  /** Repository-relative paths the diff named. */
  readonly changed: readonly string[];

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
  const { planned, changed, source, roots, baselines } = input;

  const everything = (whole: string): Affected => ({
    observe: planned,
    skipped: [],
    whole,
    because: `every subject was observed: ${whole}`,
  });

  if (changed.length === 0) {
    // Not an empty selection. A diff naming nothing is a run against a tree that
    // has not moved, and answering it with "observe nothing" would report a clean
    // suite that looked at none of it.
    return everything('the diff named no changed file, so nothing could be ruled out');
  }

  const inside = changed.filter((file) => within(file, roots));
  const declaring = declaringFiles(source);

  const opaque = inside.filter((file) => !declaring.has(file));
  if (opaque.length > 0) {
    return everything(
      `${opaque.length} changed file(s) under the scanned roots declare no component ` +
        `(${opaque.slice(0, 3).join(', ')}${opaque.length > 3 ? ', …' : ''}), and a stylesheet, ` +
        'a token file or a shared helper can move any subject without naming itself in one',
    );
  }

  const touched = new Set<string>();
  for (const [name, refs] of Object.entries(source)) {
    if (refs.some((ref) => inside.includes(ref.file))) touched.add(name);
  }

  if (touched.size === 0) {
    return everything(
      `none of the ${changed.length} changed file(s) is under the scanned roots, so this diff ` +
        'says nothing about which components moved',
    );
  }

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
      `${observe.length} of ${planned.length} subject(s) observed: ${touched.size} component(s) ` +
      `moved in ${inside.length} changed file(s), and the rest of the suite records none of them`,
  };
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
