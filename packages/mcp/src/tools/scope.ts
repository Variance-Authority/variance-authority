import type { RunReport } from '@variance-authority/report';
import { indexOf, lower } from './locate-index.js';

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
 * So nothing here is fuzzy. Segments are compared literally, lowercased and no
 * more: no stemming, no dropped extension, no partial segment, no matching a
 * path against a component or an id. A term that is not a path is refused
 * rather than reinterpreted as a word, because a filename is not unique and a
 * bare name is not a place — `I18nProvider` says which component and
 * `src/core/Containers/I18nProvider.tsx` says which file. And a start point
 * that names no file at all scopes the search to nothing, which returns
 * nothing: the alternative is answering a question the caller did not ask, out
 * of files they ruled out.
 */

/**
 * A path as the segments a person means: separators of either slash, empty
 * pieces dropped, lowercased, and otherwise exactly as written. The extension
 * stays on — `page.tsx` is a different file from `page.ts`.
 */
function segmentsOf(path: string): readonly string[] {
  return path
    .split(/[/\\]/)
    .filter((segment) => segment !== '')
    .map((segment) => lower(segment));
}

/**
 * Whether one recorded path lies at the place a start point names.
 *
 * Read as a run of segments that has to appear entire, in order and unbroken,
 * in the recorded path — which is the same statement for a file and for a
 * directory, and the reason it is put that way. `Activity/Activity.tsx` names
 * the file a run recorded as `src/pages/Activity/Activity.tsx`;
 * `src/pages/Activity` names every file under it; the absolute path an editor
 * hands over names the file too, because the shorter run may be either side.
 * A `*` stands for one segment the caller chose not to name, and a trailing one
 * is the file: `app/about-us/*` is the files of that folder and nothing deeper,
 * while `app/about-us/` is everything underneath it. The narrower of the two is
 * the one that has to be said, because a caller who says nothing about depth
 * means any depth.
 *
 * What it will not do is join two absolute paths of the same depth under
 * different roots — a build host's checkout and the caller's — which share a
 * tail and disagree above it. Nothing in a run says which of its leading
 * segments are the root, and a rule loose enough to join those would join
 * `apps/web/…/Button.tsx` to `apps/admin/…/Button.tsx`. On the corpora measured
 * it costs nothing: every recorded path answers itself, and the files a rooted
 * run records absolutely it also records unrooted.
 */
function pathHolds(value: string, term: string): boolean {
  const value_ = segmentsOf(value);
  const term_ = segmentsOf(term);
  if (value_.length === 0 || term_.length === 0) return false;

  // `app/about-us/*` is the files of that folder and no deeper: the wildcard is
  // the file, so what precedes it has to be where the file actually sits,
  // rather than somewhere above it. `app/about-us/` keeps the wildcard's job
  // for itself and means everything underneath.
  if (term_[term_.length - 1] === '*') {
    return tails(value_.slice(0, -1), term_.slice(0, -1));
  }
  return run(value_, term_);
}

/** The shorter list, read from the end, has to be the other's ending. */
function tails(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const depth = Math.min(left.length, right.length);
  for (let back = 1; back <= depth; back += 1) {
    if (!alike(left[left.length - back]!, right[right.length - back]!)) return false;
  }
  return true;
}

/** The shorter list appears in the other entire, in order and unbroken. */
function run(left: readonly string[], right: readonly string[]): boolean {
  const [longer, shorter] = left.length >= right.length ? [left, right] : [right, left];
  for (let from = 0; from + shorter.length <= longer.length; from += 1) {
    let all = true;
    for (let at = 0; at < shorter.length && all; at += 1) {
      all = alike(shorter[at]!, longer[from + at]!);
    }
    if (all) return true;
  }
  return false;
}

/**
 * One segment against one: the same text, or a `*` the caller wrote in place of
 * a segment they did not want to name.
 *
 * Literal on purpose. A stem here would let `page` answer `pages` and `card`
 * answer `cards`, and a caller handing over a coordinate did not ask to be
 * guessed at.
 */
function alike(mine: string, theirs: string): boolean {
  return mine === '*' || theirs === '*' || mine === theirs;
}

/** A start point, resolved. `subjects` empty means it named nowhere. */
export interface Scope {
  /** As the caller typed it. */
  readonly from: string;
  /** Its paths, lowercased, deduplicated. Empty when the start point was refused. */
  readonly terms: readonly string[];
  /** The subjects it names. */
  readonly subjects: ReadonlySet<string>;
  /** Paths of it no subject was recorded under. */
  readonly unmatched: readonly string[];
  /** Why the start point was not a place at all. Absent when it was one. */
  readonly refused?: string;
}

/**
 * The subjects a start point names: those recorded in a file at **every** one
 * of its paths.
 *
 * Conjunctive, unlike the ranking beside it, and for the opposite reason. A
 * rank may be generous because being wrong costs one more call; a scope that
 * was generous would put back the subjects it exists to remove, and two paths
 * in a start point are a caller narrowing deliberately rather than describing
 * more fully.
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
        .map((word) => lower(word).replace(/^["'`([]+|["'`)\],]+$/g, ''))
        .filter((word) => word !== ''),
    ),
  ];

  // A start point is a coordinate or it is refused. Reinterpreting a bare word
  // as a place is the one accommodation that cannot be made honestly: nothing
  // about `dispatch` says whether it is a folder, a component, a product area
  // or a word on a button, and a scope built on that guess quietly answers out
  // of files the caller ruled out.
  const loose = terms.filter((term) => !/[/\\]/.test(term));
  if (terms.length === 0 || loose.length > 0) {
    const named = loose.map((term) => `\`${term}\``).join(', ');
    return {
      from,
      terms: [],
      subjects: new Set<string>(),
      unmatched: [],
      refused:
        terms.length === 0
          ? 'no start point was said'
          : `the start point ${named} ${loose.length === 1 ? 'is' : 'are'} not a path`,
    };
  }

  // Only the files a subject was seen in can answer a path. The other place
  // fields — the id, the component a subject is an example of, the components
  // it holds, who mounted them, the regions it entered — are names, and a name
  // is not a location.
  const files = index.entries.filter((entry) => entry.field === 'files');

  const unmatched: string[] = [];
  let held: Set<string> | undefined;
  for (const term of terms) {
    const here = new Set<string>();
    for (const entry of files) {
      if (pathHolds(entry.value, term)) here.add(entry.subject);
    }
    if (here.size === 0) unmatched.push(term);
    held = held === undefined ? here : new Set([...held].filter((subject) => here.has(subject)));
  }

  return { from, terms, subjects: held ?? new Set<string>(), unmatched };
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
      'Say a file or a folder — `app/dispatch/page.tsx` is that file, `app/dispatch/*` its ' +
      "folder, `app/dispatch/` everything under it — and say it with its parent, because a " +
      'filename on its own is not unique. To search everywhere, leave the start point out.'
    );
  }
  if (scope.subjects.size === 0) {
    const why =
      scope.unmatched.length === 0
        ? 'no subject was recorded in a file at all of them at once'
        : `no file was seen at ${scope.unmatched.map((term) => `\`${term}\``).join(', ')}`;
    return (
      `Nothing was searched of ${indexed} subject(s): ${why}. ` +
      'A start point is a hard boundary, so no answer is given from outside it; widen it or ' +
      'leave it out.'
    );
  }
  return (
    `Searched ${scope.subjects.size} of ${indexed} subject(s), those recorded in a file at ` +
    `\`${scope.from}\`. Rarity is counted inside that scope, so a word common to this area is ` +
    'worth nothing here even when the suite at large barely says it.'
  );
}
