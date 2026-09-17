import { isAbsolute, resolve } from 'node:path';
import type { RunReport } from '@variance-authority/report';
import { indexOf } from './locate-index.js';
import type { Tree } from './tree.js';

/**
 * Where to look, said as a place on disk and nothing else.
 *
 * A description and a start point are two different kinds of word and a reader
 * that mixes them answers neither well. *The overdue badge* says what a person
 * is looking at; `app/billing/` says which files they are willing to be
 * answered from. Folded into one query the second is just three more words to
 * match, and the suite's billing screens compete with every other screen that
 * happens to say `billing` on it — which on a real application is most of them,
 * because a product says its own name everywhere.
 *
 * Kept apart, the start point does the one thing a description cannot: it
 * removes subjects. That matters twice over. Fewer rows is the small half. The
 * large half is that rarity is a count over subjects, so counting it inside the
 * scope changes what the words are worth — a word every screen in the
 * application says is still worth nothing, and a word every screen *in this
 * area* says is worth nothing here, which is a different and more useful
 * statement.
 *
 * ## The description may be loose. The place may not.
 *
 * What is being looked for is allowed to be approximate: a caller who types
 * *the overdue badge* is describing something they half remember, and the
 * ranking is built to reward a near miss. Where to look is the opposite kind of
 * argument. It is a coordinate the caller already has — the file open in front
 * of them, the folder they are working in — and every softening of it silently
 * widens the pond they said to fish in.
 *
 * ## A path exists or it does not
 *
 * That is the entire rule, and there is deliberately nothing under it. A start
 * point is read from its root down and compared segment for whole segment:
 * `apps/web/Badge.tsx` is that file, `apps/web/` is that directory. Nothing is
 * looked for *inside* a path. `Badge.tsx` names a file at the root, and where
 * no file is at the root there is nothing there and the answer is not found —
 * not *found under apps/web*, and not *ambiguous between two packages*. Two
 * candidates being handed back was the same defect wearing a politer face: it
 * is still the tool reading a fragment as though it were a path.
 *
 * So: no stemming, no dropped extension, no partial segment, no matching tail,
 * no run of segments found somewhere in the middle, no case folding, no
 * matching a path against a component or an id, and no reading one recorded
 * path as another because one ends with the other. A `*` is the one thing that
 * stands for something, and only because the caller wrote it, and only as the
 * last segment.
 *
 * ## The tree says what exists, and the run says what it produced
 *
 * Those are two questions and they have two authorities. Whether a path is
 * there is a fact about the source tree, and only [`tree.ts`](./tree.ts)
 * answers it — not the file paths an observation recorded, which are the files
 * a run was *seen in* and are wrong in both directions about what is on disk.
 * Which subject a file produced is a fact about the run, and only the report
 * answers that.
 *
 * ## And the path is the entrance, not the room
 *
 * A start point selects **entry points**; the import graph decides the scope. A
 * file is in it when it is reachable *from* an entry point, along the arrows,
 * at any depth — and a file outside that closure is rejected outright rather
 * than ranked low. The walk runs one way only. What an entry point rests on is
 * its neighbourhood; what happens to import an entry point is not, or naming
 * one leaf would name the application.
 *
 * Upward is the report's job, not the graph's: a subject is in scope when a
 * file in scope produced it, so a leaf in scope carries in every subject the
 * run recorded as having rendered it. That is the entire reason a start point
 * exists: *the checkout page* is one file and forty neighbours, and a caller
 * who names the page means the area.
 */

/**
 * A path as the segments a person means: separators of forward slash, empty
 * pieces dropped, and otherwise exactly as written. The extension stays on —
 * `page.tsx` is a different file from `page.ts` — and so does the case, because
 * a path that differs in case is a path that does not exist.
 *
 * A backslash is a character in a name here, not a separator. Sense's
 * coordinates are repo-relative with forward slashes, so reading
 * `src\billing\Card.tsx` as three segments is one more inference about what
 * somebody meant.
 */
function segmentsOf(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment !== '');
}

/** The widths a start point can be said at. */
type Width = 'file' | 'under' | 'own';

/**
 * Which width the caller asked for, or nothing when what they wrote is not a
 * path at all.
 *
 * Three forms and no others. `apps/web/Badge.tsx` is that file;
 * `apps/web/` is everything under it at any depth; `apps/web/*` is that
 * directory's own files and nothing deeper. Say nothing about depth and you
 * mean any depth, which is why the folder is the wider of the two and the
 * trailing `*` is the one that stops.
 *
 * A `*` anywhere but the last segment is not one of the three. It would be a
 * pattern, and a pattern is not a path.
 */
function widthOf(term: string): Width | undefined {
  const segments = segmentsOf(term);
  if (segments.length === 0) return undefined;
  if (segments.slice(0, -1).some((segment) => segment.includes('*'))) return undefined;
  const last = segments[segments.length - 1]!;
  if (last === '*') return segments.length === 1 ? undefined : 'own';
  if (last.includes('*')) return undefined;
  return term.endsWith('/') ? 'under' : 'file';
}

/**
 * Whether one path in the tree is at the place a start point names.
 *
 * Anchored at the root and compared whole: the caller's segments have to *be*
 * the beginning of the tree's path, in order, character for character. The
 * width then says how much of the rest is allowed — none for a file, one
 * segment for a directory's own files, any depth for a directory.
 */
function at(value: string, term: string, width: Width): boolean {
  const value_ = segmentsOf(value);
  const term_ = segmentsOf(term);
  const named = width === 'own' ? term_.slice(0, -1) : term_;
  if (named.length === 0) return false;

  const depth =
    width === 'file' ? named.length : width === 'own' ? named.length + 1 : undefined;
  if (depth !== undefined ? value_.length !== depth : value_.length <= named.length) return false;
  for (let segment = 0; segment < named.length; segment += 1) {
    if (named[segment] !== value_[segment]) return false;
  }
  return true;
}

/**
 * An absolute path as the repo-relative one the tree holds, or nothing when it
 * is outside the repository.
 *
 * A caller pasting the path of the file open in front of them has pasted an
 * absolute one, and under the root it names exactly the coordinate the tree
 * uses. Outside the root it is a real path to a real file that this repository
 * does not contain, which is *not found* and not an error.
 */
function underRoot(term: string, root: string): string | undefined {
  if (!isAbsolute(term)) return term;
  const base = segmentsOf(resolve(root));
  const said = segmentsOf(term);
  for (let segment = 0; segment < base.length; segment += 1) {
    if (base[segment] !== said[segment]) return undefined;
  }
  // The width the caller said survives the move: a trailing separator is not a
  // segment, so it is put back by hand.
  return `${said.slice(base.length).join('/')}${term.endsWith('/') ? '/' : ''}`;
}

/** A start point, resolved. */
export interface Scope {
  /** Its paths as written, deduplicated. Empty when the start point was refused. */
  readonly terms: readonly string[];
  /** The subjects in it: those a file in scope produced. */
  readonly subjects: ReadonlySet<string>;
  /** The paths answered along the imports, as said, in order. */
  readonly from: readonly string[];
  /** The paths answered against the imports, as said, in order. */
  readonly to: readonly string[];
  /** Paths of it that resolved to nothing. */
  readonly unmatched: readonly string[];
  /** Files the paths themselves named. */
  readonly entries: number;
  /** Files in the closure, entry points included. */
  readonly reachable: number;
  /** Files in scope whose own imports the scan could not enumerate. */
  readonly unresolved: readonly string[];
  /**
   * Distinct files the run recorded, and how many of those the tree never heard
   * of — not *outside the scope*, absent from the source tree entirely.
   *
   * The two sides of the join are spelled by different authorities. The tree
   * writes paths from the repository root; a recorded path is whatever a source
   * map said, resolved against the module the browser was served. Those agree
   * when the server's root is the repository's and can disagree when it is not:
   * a bundle under `storybook-static/assets/` resolves `../../src/Button.tsx`
   * to `src/Button.tsx` whatever package it really lives in.
   *
   * Kept as a count so a scope that found nothing can say which nothing it is.
   * Some strangers are ordinary — a run records files a checkout has since
   * deleted. All of them, with subjects to spare, is not a narrow scope.
   */
  readonly recorded: number;
  readonly strangers: number;
  /**
   * Subject → the cheapest way in to any file it was recorded in, in half-hops.
   *
   * Recorded, and read by nothing: the order an answer comes back in is decided
   * by the words, and this is here so a ranking can be *measured* against
   * position before it is changed by it. Cheapest of the subject's files rather
   * than a mean, because reachability is already "any one of its files" and
   * this is that predicate sharpened, not a different one.
   *
   * Empty for a refused start point, and empty for the `to` direction's own
   * arithmetic in the sense that the two directions are unioned here the way
   * the closure is: a subject in both keeps the cheaper.
   */
  readonly hops: ReadonlyMap<string, number>;
  /** Why the start point was not found. Absent when it resolved. */
  readonly refused?: string;
}

/**
 * One path as the paths it was said as.
 *
 * One string is one path, whole. Splitting it on spaces is how a file whose
 * name has a space in it becomes unsayable and comes back *not found* — a
 * false negative about a file that is plainly there, which is the failure this
 * entire rule exists against. Several paths are said as several strings. The
 * outer whitespace goes, and nothing else does: no quote stripping, no comma
 * splitting, because both are guesses about typing that land on a real
 * character in a real name.
 */
function pathsOf(said: string | readonly string[] | undefined): readonly string[] {
  if (said === undefined) return [];
  const many = typeof said === 'string' ? [said] : said;
  return [...new Set(many.map((term) => term.trim()).filter((term) => term !== ''))];
}

/** The files a set of paths names, and the paths that named nothing. */
function entryPoints(
  terms: readonly string[],
  tree: Tree,
): { readonly found: readonly string[]; readonly unmatched: readonly string[]; readonly files: ReadonlySet<string> } {
  const found: string[] = [];
  const unmatched: string[] = [];
  const files = new Set<string>();

  for (const term of terms) {
    const said = underRoot(term, tree.root);
    const width = said === undefined ? undefined : widthOf(said);
    let here = false;
    if (said !== undefined && width !== undefined) {
      for (const file of tree.files) {
        if (!at(file, said, width)) continue;
        files.add(file);
        here = true;
      }
    }
    if (here) found.push(term);
    else unmatched.push(term);
  }
  return { found, unmatched, files };
}

/**
 * The subjects a start point names: those produced by a file in the closure of
 * **any** one of its paths.
 *
 * Two directions, and the caller says which. `from` is answered along the
 * imports — what that file rests on, its neighbourhood. `to` is answered
 * against them — what rests on that file, which is the other question a person
 * in a helper actually asks: *what shows this?* One walk each way, never both
 * from one path, because a path that meant both would mean nothing: name a leaf
 * of a design system and the answer is the application.
 *
 * Several paths are several start points, and a caller with two entry points
 * into the same investigation — the settings page and the invite modal — is
 * naming two places to be answered from, not asking for the files common to
 * both. Common to both is very nearly always nothing: two different entry
 * points of one application share almost no file, so an intersection would
 * quietly answer nothing at exactly the moment the caller was most specific.
 * `from` and `to` together are two start points for the same reason.
 */
export function scopeOf(
  report: RunReport,
  from: string | readonly string[] | undefined,
  tree: Tree | undefined,
  to?: string | readonly string[],
): Scope {
  const fromTerms = pathsOf(from);
  const toTerms = pathsOf(to);
  const terms = [...new Set([...fromTerms, ...toTerms])];
  const nowhere = {
    terms: [] as readonly string[],
    subjects: new Set<string>(),
    from: [] as readonly string[],
    to: [] as readonly string[],
    unmatched: [] as readonly string[],
    entries: 0,
    reachable: 0,
    unresolved: [] as readonly string[],
    recorded: 0,
    strangers: 0,
    hops: new Map<string, number>() as ReadonlyMap<string, number>,
  };

  if (terms.length === 0) return { ...nowhere, refused: 'no start point was said' };

  // No tree, no answer. Falling back to the paths the run recorded would answer
  // a question nobody asked — those are the files a run was seen in, not the
  // files that are there — and it would answer it while looking like this.
  if (tree === undefined) {
    return {
      ...nowhere,
      terms,
      refused:
        'a start point is a path in the source tree, and no source tree was read. Ask from a ' +
        'checkout of the repository the run was made in, or ask without a start point',
    };
  }

  const down = entryPoints(fromTerms, tree);
  const up = entryPoints(toTerms, tree);
  const unmatched = [...down.unmatched, ...up.unmatched];

  // Not found is a rejection, not an empty result, and it is the only failure
  // there is. The caller handed over a coordinate; the tree does not have it.
  // Saying so is a different fact from saying the place exists and holds
  // nothing, and it is the difference between fixing a typo and looking
  // somewhere else.
  if (unmatched.length > 0) {
    const named = unmatched.map((term) => `\`${term}\``).join(', ');
    return {
      ...nowhere,
      terms,
      from: down.found,
      to: up.found,
      unmatched,
      refused: `${named} ${unmatched.length === 1 ? 'is' : 'are'} not found — the source tree holds no file at that path`,
    };
  }

  const entries = new Set([...down.files, ...up.files]);
  const reachable = new Set([...tree.reachedFrom(down.files), ...tree.reaching(up.files)]);

  // The report answers the second question and only the second: which subject
  // each file produced. The other place-shaped fields — the id, the component a
  // subject is an example of, the components it holds, who mounted them, the
  // regions it entered — are names, and a name is not a location.
  const cost = new Map<string, number>([...tree.hopsFrom(down.files)]);
  for (const [file, paid] of tree.hopsTo(up.files)) {
    if (paid < (cost.get(file) ?? Infinity)) cost.set(file, paid);
  }

  const subjects = new Set<string>();
  const hops = new Map<string, number>();
  const recorded = new Set<string>();
  const strangers = new Set<string>();
  for (const entry of indexOf(report).entries) {
    if (entry.field !== 'files') continue;

    // Asked of the whole tree, not of the closure. Whether a recorded path is
    // in scope is the question being answered; whether it is on disk at all is
    // the question of whether the answer means anything.
    recorded.add(entry.value);
    if (!tree.files.has(entry.value)) strangers.add(entry.value);

    if (!reachable.has(entry.value)) continue;
    subjects.add(entry.subject);
    const paid = cost.get(entry.value);
    if (paid !== undefined && paid < (hops.get(entry.subject) ?? Infinity)) {
      hops.set(entry.subject, paid);
    }
  }

  return {
    terms,
    subjects,
    from: down.found,
    to: up.found,
    unmatched,
    entries: entries.size,
    reachable: reachable.size,
    unresolved: tree.unknownAmong(reachable),
    recorded: recorded.size,
    strangers: strangers.size,
    hops,
  };
}

/**
 * What the header says about a start point, before any hit.
 *
 * Always printed when one was given, including — especially — when it named
 * nothing, because the difference between *this area holds no such thing* and
 * *there is no such area* is the difference between asking again and asking
 * somewhere else, and only the tool knows which happened.
 */
export function scopeLine(scope: Scope, indexed: number): string {
  if (scope.refused !== undefined) {
    return (
      `No search was run: ${scope.refused}. ` +
      'Say a real path from the root — `app/dispatch/page.tsx` is that file, `app/dispatch/*` ' +
      "its folder's own files, `app/dispatch/` everything under it. A name on its own is not a " +
      'path. To search everywhere, leave the start point out.'
    );
  }

  // Counted and said rather than widened over. A file whose imports could not
  // be enumerated may import anything, so the scope is not a proof about what
  // it leaves out — but unioning in every file that reaches an unknown one is
  // 209 of this repository's 1,574 files whatever the start point was, which is
  // not a narrowing any caller would recognise as one.
  const holes =
    scope.unresolved.length === 0
      ? ''
      : ` ${scope.unresolved.length} file(s) in it import something the scan could not resolve, ` +
        'so what lies behind those is not enumerated.';

  // Nothing in scope, and nothing the run recorded is on disk under the name it
  // was recorded under. That is not a narrow scope, it is two authorities
  // spelling the same file differently, and answering `0 of 312` would report
  // it as a fact about the application. The numbers are kept beside the
  // sentence so a reader can see it is the whole set and not a stale entry.
  if (scope.subjects.size === 0 && scope.recorded > 0 && scope.strangers === scope.recorded) {
    return (
      `No subject could be placed: the run recorded ${scope.recorded} file(s) and the source ` +
      'tree holds none of them, so nothing here can be matched to a place. The two are spelled by ' +
      'different authorities — the tree from the repository root, the run from whatever its ' +
      'source maps resolved against — and they agree only when the server\'s root was the ' +
      'repository\'s. Ask from the root the run was served from, or ask without a start point.'
    );
  }

  // The direction is said, not implied by the number. *Reachable from the
  // settings page* and *reaching the user-select* are different questions with
  // the same shape of answer, and a header that printed the same sentence for
  // both would leave the reader unable to tell which one was asked.
  const named = (places: readonly string[]): string =>
    places.map((place) => `\`${place}\``).join(' and ');
  const along = scope.from.length === 0 ? '' : `reachable from ${named(scope.from)}`;
  const against = scope.to.length === 0 ? '' : `reaching ${named(scope.to)}`;
  const closure =
    scope.from.length === 0
      ? `${scope.reachable} reaching them along the imports`
      : scope.to.length === 0
        ? `${scope.reachable} reachable from them along the imports`
        : `${scope.reachable} in the two closures together`;

  return (
    `Searched ${scope.subjects.size} of ${indexed} subject(s), those produced by a file ` +
    `${[along, against].filter((half) => half !== '').join(' or ')} — ` +
    `${scope.entries} file(s) named, ${closure}. Rarity is counted inside that scope, so a ` +
    `word common to this area is worth nothing here even when the suite at large barely ` +
    `says it.${holes}`
  );
}
