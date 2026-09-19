import {
  indexSource,
  mergeSourceIndexes,
  type SourceIndex,
} from '@variance-authority/core/attribute';
import type { BeforeReach, Relations } from '@variance-authority/core/relate';
import { componentsReached, many, refused, within, type InstallDiff } from './reach.js';

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
 * - a run that cannot list its changed files at all does not narrow;
 * - an install this cannot read at both revisions does not narrow — a bumped
 *   package is invisible without it, and invisible is the one thing a selector
 *   may not treat as *nothing happened*.
 *
 * ## One state this cannot resolve, and so states instead
 *
 * A diff can reach components **no baseline records**, and that is two facts
 * wearing one shape. `Button` nothing has a story for is a component this suite
 * does not watch, and skipping every subject is the right and cheap answer.
 * `RootLayout` is rendered by every page in the app and appears in no client
 * fiber tree, because it is a server component — and skipping every subject
 * reports success over a stylesheet that repainted the shop.
 *
 * Nothing here can tell them apart, and nothing here is going to: an observation
 * surface narrower than the source tree is the ordinary state of a repository,
 * not a defect to be inferred around. So the run **narrows and says so**, naming
 * what it reached and could not match, and `unrendered: 'whole'` is where an
 * operator who knows those components are painted says the run must widen.
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
   * What the run rests on before any test imports it, when entry points were
   * declared.
   *
   * The other side of `roots`. Those say where the files this can reason about
   * live; this says which files govern the run from outside that set — a setup
   * module, an environment, the packages a config rests on. Nothing has an edge
   * to one of them, so the walk below cannot find them and cannot be allowed to
   * answer *reaches nothing* about them.
   */
  readonly before?: BeforeReach;

  /**
   * Component names each planned subject's stored baseline recorded.
   *
   * `undefined` for a subject with no baseline, and for one whose baseline
   * predates the field. Both mean *unknown*, and both are observed.
   */
  readonly baselines: ReadonlyMap<string, readonly string[] | undefined>;

  /**
   * What a change reaching only components no baseline records should do.
   *
   * `narrow` by default: a suite watches less than it builds, and a change
   * landing outside what it watches is the ordinary reason to run nothing.
   * `whole` is the operator's statement that their subjects render those
   * components without recording them — which a server component, and for now
   * anything outside the browser, always does.
   */
  readonly unrendered?: 'whole' | 'narrow';

  /**
   * The file graph, when one was built.
   *
   * Absent is the declaration-only selector, which is what a repository with no
   * scanner configured gets and is why this is optional rather than required.
   * Present replaces *what does this file declare* with *what reaches it* — and
   * changes nothing about which uncertainties refuse to narrow.
   */
  readonly relations?: Relations;

  /**
   * What the diff did to the **install** — the far end of the same line the
   * graph walks, and the half a file diff cannot see.
   *
   * A changed lockfile is not evidence: a workspace version bump rewrites one
   * and installs nothing. The lockfile read at both revisions *is* evidence,
   * and it is read as package names, because which instance of `jsdom` a
   * resolver handed a given importer is a question only that resolver can
   * answer. Names over-include, which is the safe direction.
   *
   * Seeds only, exactly like `changedDirs`: the graph narrows outward from a
   * bumped package the same way it narrows outward from an edited file, and a
   * package no file imports reaches nothing. Absent is *no reading was taken*,
   * and then a changed lockfile is an ordinary unreadable changed file again.
   */
  readonly install?: InstallDiff;
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

  /**
   * Components this diff reached that no baseline records, when that was every
   * one of them.
   *
   * Present only when the narrowing then ruled out every subject in the suite,
   * which is the one zero worth a sentence: either nothing here watches what
   * changed, or something here renders it without recording it, and the run
   * cannot see which. Absent is the ordinary case and includes the ordinary
   * partial one — a component nobody rendered beside one they did is what a real
   * scan looks like.
   */
  readonly unwatched?: readonly string[];

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
  const install = input.install;

  const everything = (whole: string): Affected => ({
    observe: planned,
    skipped: [],
    whole,
    because: `every subject was observed: ${whole}`,
  });

  // Before anything else, because it is the one uncertainty that makes the rest
  // of the evidence untrustworthy rather than merely incomplete: a diff whose
  // install cannot be compared may have bumped every package in it, and the
  // changed-file list would look exactly the same.
  if (install !== undefined && 'whole' in install) return everything(install.whole);

  const moved = install === undefined ? [] : install.packages;
  if (changed.length === 0 && changedDirs.length === 0 && moved.length === 0) {
    // Not an empty selection. A diff naming nothing is a run against a tree that
    // has not moved, and answering it with "observe nothing" would report a clean
    // suite that looked at none of it.
    return everything('the diff named no changed file, so nothing could be ruled out');
  }

  const narrowing =
    relations === undefined
      ? byDeclaration(changed, changedDirs, source, roots, moved)
      : byRelation(changed, changedDirs, relations, roots, install, input.before);

  if ('whole' in narrowing) return everything(narrowing.whole);
  const { touched, how } = narrowing;

  // The state the baselines are needed to see, and the only one this cannot
  // resolve on its own. Carried to the caller either way — as a widening when the
  // operator has said those components are painted, and otherwise as the sentence
  // under a run that observed nothing.
  const unseen = unrenderedIn(touched, baselines);
  if (unseen !== undefined && input.unrendered === 'whole') {
    return everything(
      `this diff reaches ${many(unseen.length, 'component')} no baseline records ` +
        `(${sample(unseen)}), and \`source.unrendered\` says this suite paints that surface ` +
        'without recording it',
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
        `its baseline records ${many(components.length, 'component')} and this diff touched none of ` +
        `them (${[...touched].slice(0, 3).join(', ')}${touched.size > 3 ? ', …' : ''})`,
    });
  }

  return {
    observe,
    skipped,
    ...(unseen === undefined ? {} : { unwatched: unseen }),
    because:
      `${observe.length} of ${many(planned.length, 'subject')} observed: ${how}, and the rest of the ` +
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
  moved: readonly string[],
): Narrowing {
  // Reading the install is only half the answer; the other half is *which files
  // import that package*, and that is the graph. Without one, a bumped package
  // is a change this selector can see and cannot place — which is a whole run,
  // and a loud one, because the fix is a single line of config.
  if (moved.length > 0) {
    return {
      whole:
        `the install moved ${many(moved.length, 'package')} (${sample(moved)}) and no file graph ` +
        'is configured, so nothing here can say which files import them — set ' +
        '`source: { relations: true }` to answer this exactly',
    };
  }

  const inside = changed.filter((file) => within(file, roots));
  const declaring = declaringFiles(source);

  const undeclared = inside.filter((file) => !declaring.has(file));
  if (undeclared.length > 0) {
    return {
      whole:
        `${many(undeclared.length, 'changed file')} under the scanned roots ${undeclared.length === 1 ? 'declares' : 'declare'} no component ` +
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
        `none of the ${many(changed.length, 'changed file')} is under the scanned roots, so this diff ` +
        'says nothing about which components moved',
    };
  }

  return {
    touched,
    how: `${many(touched.size, 'component')} moved in ${many(inside.length, 'changed file')}`,
  };
}

/**
 * What a diff moved, by walking the graph backwards from every changed file.
 *
 * A thin wrapper, and deliberately so: the walk and its three refusals live in
 * [`reach.ts`](./reach.ts) because the report makes the same call for the
 * opposite purpose. Everything this selector rules out, the report explains — and
 * the two must not be able to disagree about which file reached what.
 *
 * The refusals arrive here as a `whole`, which is exactly the widening this
 * selector already does for every other uncertainty.
 */
function byRelation(
  changed: readonly string[],
  changedDirs: readonly string[],
  relations: Relations,
  roots: readonly string[],
  install: InstallDiff | undefined,
  before: BeforeReach | undefined,
): Narrowing {
  // The same call the report makes. Two walks would let the run skip a subject
  // for one reason and print another, and the printed one is what a reviewer
  // acts on.
  const reach = componentsReached(relations, changed, changedDirs, roots, install, before);
  if (refused(reach)) return { whole: reach.whole };

  return { touched: new Set(reach.components.map((entry) => entry.component)), how: reach.how };
}

/**
 * The reached components, when no baseline records a single one of them.
 *
 * **Only when none is.** One component nobody rendered beside one they did is the
 * ordinary state of a real scan — `const Comp = asChild ? Slot : 'button'` is a
 * component to an index and to nothing else — and answering on that would put the
 * sentence under every run that touched a file importing one.
 *
 * `undefined` too when the baselines record nothing at all. A suite whose
 * subjects are new, or whose baselines predate the component list, observes every
 * one of them for that reason already, and a line about what nobody rendered
 * belongs under a run that ruled something out.
 */
function unrenderedIn(
  touched: ReadonlySet<string>,
  baselines: ReadonlyMap<string, readonly string[] | undefined>,
): readonly string[] | undefined {
  let recorded = 0;

  for (const components of baselines.values()) {
    if (components === undefined) continue;
    recorded += components.length;
    if (components.some((component) => touched.has(component))) return undefined;
  }

  return recorded === 0 ? undefined : [...touched].sort();
}

/** The first three of a list, with a mark when there are more. */
function sample(files: readonly string[]): string {
  return `${files.slice(0, 3).join(', ')}${files.length > 3 ? ', …' : ''}`;
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
