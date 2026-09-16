import type { RunReport } from '@variance-authority/report';
import { indexOf } from './locate-index.js';

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
 */

/**
 * A path as the segments a person means: separators of either slash, empty
 * pieces dropped, and otherwise exactly as written. The extension stays on —
 * `page.tsx` is a different file from `page.ts` — and so does the case, because
 * a path that differs in case is a path that does not exist.
 */
function segmentsOf(path: string): readonly string[] {
  return path.split(/[/\\]/).filter((segment) => segment !== '');
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
  return /[/\\]$/.test(term) ? 'under' : 'file';
}

/**
 * Whether one recorded path is at the place a start point names.
 *
 * Anchored at the root and compared whole: the caller's segments have to *be*
 * the beginning of the recorded path, in order, character for character. The
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

/** A start point, resolved. `subjects` empty means it named nowhere. */
export interface Scope {
  /** As the caller typed it. */
  readonly from: string;
  /** Its paths as written, deduplicated. Empty when the start point was refused. */
  readonly terms: readonly string[];
  /** The subjects it names. */
  readonly subjects: ReadonlySet<string>;
  /** Where each path resolved to, in the order they were said. */
  readonly at: readonly string[];
  /** Paths of it that resolved to nothing. */
  readonly unmatched: readonly string[];
  /** Why the start point was not found. Absent when it resolved. */
  readonly refused?: string;
}

/**
 * The subjects a start point names: those recorded in a file at **any** one of
 * its paths.
 *
 * Several paths are several start points, and a caller with two entry points
 * into the same investigation — the settings page and the invite modal — is
 * naming two places to be answered from, not asking for the files common to
 * both. Common to both is very nearly always nothing: two different entry
 * points of one application share almost no file, so an intersection would
 * quietly answer nothing at exactly the moment the caller was most specific.
 */
export function scopeOf(report: RunReport, from: string): Scope {
  const index = indexOf(report);
  const terms = [
    ...new Set(
      from
        .split(/\s+/)
        // Quotes, brackets and a trailing comma are how a path arrives when it
        // was copied out of something. A trailing `*` or separator is not
        // punctuation — it is the width the caller asked for — and stays.
        .map((word) => word.replace(/^["'`([]+|["'`)\],]+$/g, ''))
        .filter((word) => word !== ''),
    ),
  ];

  if (terms.length === 0) {
    return { from, terms: [], subjects: new Set<string>(), at: [], unmatched: [], refused: 'no start point was said' };
  }

  // Only the files a subject was seen in can answer a path. The other place
  // fields — the id, the component a subject is an example of, the components
  // it holds, who mounted them, the regions it entered — are names, and a name
  // is not a location.
  const files = index.entries.filter((entry) => entry.field === 'files');

  const found: string[] = [];
  const unmatched: string[] = [];
  const held = new Set<string>();

  for (const term of terms) {
    const width = widthOf(term);
    let here = false;
    if (width !== undefined) {
      for (const entry of files) {
        if (!at(entry.value, term, width)) continue;
        held.add(entry.subject);
        here = true;
      }
    }
    if (here) found.push(term);
    else unmatched.push(term);
  }

  // Not found is a rejection, not an empty result, and it is the only failure
  // there is. The caller handed over a coordinate; this run does not have it.
  // Saying so is a different fact from saying the place exists and holds
  // nothing, and it is the difference between fixing a typo and looking
  // somewhere else.
  if (unmatched.length > 0) {
    const named = unmatched.map((term) => `\`${term}\``).join(', ');
    return {
      from,
      terms,
      subjects: new Set<string>(),
      at: found,
      unmatched,
      refused: `${named} ${unmatched.length === 1 ? 'is' : 'are'} not found — no file of this run is at that path`,
    };
  }

  return { from, terms, subjects: held, at: found, unmatched };
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
  return (
    `Searched ${scope.subjects.size} of ${indexed} subject(s), those recorded in a file at ` +
    `${scope.at.map((place) => `\`${place}\``).join(' and ')}. Rarity is counted inside that ` +
    'scope, so a word common to this area is worth nothing here even when the suite at large ' +
    'barely says it.'
  );
}
