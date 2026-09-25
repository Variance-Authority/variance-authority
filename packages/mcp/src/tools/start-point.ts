import { isAbsolute, resolve } from 'node:path';
import type { Tree } from './tree.js';

/**
 * Where to look, said as a place on disk and nothing else.
 *
 * A description and a start point are two different kinds of word, and this
 * module owns the second one: turning what a caller wrote into files the tree
 * actually holds. What is then *done* with those files — which subjects they
 * produced, which names they declare — belongs to whoever asked.
 *
 * ## The description may be loose. The place may not.
 *
 * What is being looked for is allowed to be approximate: a caller who types
 * *the overdue badge* is describing something they half remember, and a ranking
 * can be built to reward a near miss. Where to look is the opposite kind of
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
 * ## The tree says what exists
 *
 * Whether a path is there is a fact about the source tree, and only
 * [`tree.ts`](./tree.ts) answers it — not the file paths an observation
 * recorded, which are the files a run was *seen in* and are wrong in both
 * directions about what is on disk.
 *
 * ## And the path is the entrance, not the room
 *
 * A start point selects **entry points**; the import graph decides what is in
 * reach. A file is in it when it is reachable *from* an entry point, along the
 * arrows, at any depth — and a file outside that closure is rejected outright
 * rather than ranked low. Each walk runs one way only, and the caller names
 * which: what an entry point rests on is its neighbourhood, and what happens to
 * import an entry point is a different question with a different answer.
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
function at(term: string, width: Width): (value: string) => boolean {
  const term_ = segmentsOf(term);
  const named = width === 'own' ? term_.slice(0, -1) : term_;
  if (named.length === 0) return () => false;
  const depth =
    width === 'file' ? named.length : width === 'own' ? named.length + 1 : undefined;
  // A path with no empty segment is its segments joined, so whether it starts
  // at the named place is one comparison, not a split. The tree holds every file
  // in the checkout, and splitting all of them costs more than the walk the
  // start point opens. Anything else is split and compared as said.
  const prefix = `${named.join('/')}/`;
  return (value) => {
    if (value.charCodeAt(0) !== 47 && !value.includes('//') && !value.startsWith(prefix)) {
      if (width !== 'file' || value !== prefix.slice(0, -1)) return false;
    }
    const value_ = segmentsOf(value);
    if (depth !== undefined ? value_.length !== depth : value_.length <= named.length) return false;
    for (let segment = 0; segment < named.length; segment += 1) {
      if (named[segment] !== value_[segment]) return false;
    }
    return true;
  };
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
export function pathsOf(said: string | readonly string[] | undefined): readonly string[] {
  if (said === undefined) return [];
  const many = typeof said === 'string' ? [said] : said;
  return [...new Set(many.map((term) => term.trim()).filter((term) => term !== ''))];
}

/** The files a set of paths names, and the paths that named nothing. */
export interface EntryPoints {
  /** The paths that named at least one file, as said, in order. */
  readonly found: readonly string[];
  /** The paths that named none. */
  readonly unmatched: readonly string[];
  /** Every file they named between them. */
  readonly files: ReadonlySet<string>;
}

/** The files a set of paths names, and the paths that named nothing. */
export function entryPoints(terms: readonly string[], tree: Tree): EntryPoints {
  const found: string[] = [];
  const unmatched: string[] = [];
  const files = new Set<string>();

  for (const term of terms) {
    const said = underRoot(term, tree.root);
    const width = said === undefined ? undefined : widthOf(said);
    let here = false;
    if (said !== undefined && width !== undefined) {
      const named = at(said, width);
      for (const file of tree.files) {
        if (!named(file)) continue;
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
 * Why a set of paths cannot be answered from, or nothing when it can.
 *
 * Not found is a rejection, not an empty result, and it is the only failure
 * there is. The caller handed over a coordinate; the tree does not have it.
 * Saying so is a different fact from saying the place exists and holds nothing,
 * and it is the difference between fixing a typo and looking somewhere else.
 */
export function refusalFor(unmatched: readonly string[]): string | undefined {
  if (unmatched.length === 0) return undefined;
  const named = unmatched.map((term) => `\`${term}\``).join(', ');
  return `${named} ${unmatched.length === 1 ? 'is' : 'are'} not found — the source tree holds no file at that path`;
}

/**
 * The start point as it was said, or nothing.
 *
 * A string is one path and an array is several, and neither is read any further
 * here: a path with a space in it is a path, so nothing is split, and an empty
 * one is nothing said rather than a path that failed.
 */
export function startPointArg(
  input: Readonly<Record<string, unknown>>,
  which: string,
): string | readonly string[] | undefined {
  const said = input[which];
  if (typeof said === 'string') return said.trim() === '' ? undefined : said;
  if (!Array.isArray(said)) return undefined;
  const paths = said.filter((term): term is string => typeof term === 'string' && term.trim() !== '');
  return paths.length === 0 ? undefined : paths;
}

/**
 * What a tool says about `from` and `to` in its own schema.
 *
 * One rule about what a path means, said once. Two servers that each wrote
 * their own paragraph would drift, and the drift lands on the model as
 * `app/billing/` meaning one thing in one tool and another in the next.
 *
 * The text is sent in every `tools/list`, so it states the rule and not the
 * argument for it. A path is read from the root down, whole segment for whole
 * segment, case included, against the files the repository holds; nothing is
 * looked for inside it, so `Badge.tsx` is a file at the root and not the one
 * under `apps/web`, and a path that is not there is rejected as not found
 * (`refusalFor`). A `*` anywhere but the last segment is a pattern and is
 * refused. One string is one path, spaces and all; an array is several entry
 * points taken together. Nothing outside the closure is answered from.
 */
export const START_POINT_SCHEMA = {
  from: {
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    description:
      'Optional. Repo-relative path, or an array of them: `app/dispatch/page.tsx` a file, ' +
      "`app/dispatch/*` that folder's own files, `app/dispatch/` everything under it. Exact " +
      'case, from the root, no other globs; a path the repository does not hold is rejected. ' +
      'Scope: everything it imports, transitively. `to` is the other direction.',
  },
  to: {
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    description:
      'Optional. Same path forms as `from`. Scope: everything that imports it, transitively. ' +
      'With `from`, the two scopes are answered side by side, not intersected.',
  },
} as const;
