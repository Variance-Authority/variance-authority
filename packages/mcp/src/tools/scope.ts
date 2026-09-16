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
 * path against a component or an id.
 *
 * ## A start point is resolved or it is not found
 *
 * There is one test and it is not a test of shape. A start point is looked up,
 * and what it resolves to is a location this run actually knows. Resolving to
 * nothing is *not found* — the same answer a missing file gets, for the same
 * reason — and it scopes the search to nothing, which returns nothing, because
 * the alternative is answering a question the caller did not ask out of files
 * they ruled out.
 *
 * Resolving to more than one unrelated location is not found either, stated
 * differently: `I18nProvider` is the component's name and two packages may both
 * declare a file by it, so a run that picked one of them would be guessing on
 * the caller's behalf at exactly the moment the caller handed over a
 * coordinate. The two places are named back instead. This is why the width a
 * caller asks for is not ambiguity: `app/billing/` resolves to `app/billing`
 * however many files sit beneath it, because what is looked up is where the
 * named run ends, not how much lies under it. A `*` is the caller saying *any*
 * out loud, and is never read back to them as a question.
 */

/** How many of a start point's places are named back before the rest are counted. */
const PLACES_NAMED = 2;

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
 * Where one recorded path answers a start point, or nothing.
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
 * What comes back is *where* it matched, down to the last segment the caller
 * named, rather than merely that it did. That is what makes the answer
 * checkable: a start point matching in two unrelated places has not been
 * resolved, it has been guessed, and the caller is told so instead.
 *
 * What it will not do is join two absolute paths of the same depth under
 * different roots — a build host's checkout and the caller's — which share a
 * tail and disagree above it. Nothing in a run says which of its leading
 * segments are the root, and a rule loose enough to join those would join
 * `apps/web/…/Button.tsx` to `apps/admin/…/Button.tsx`. On the corpora measured
 * it costs nothing: every recorded path answers itself, and the files a rooted
 * run records absolutely it also records unrooted.
 */
function resolves(value: string, term: string): string | undefined {
  const value_ = segmentsOf(value);
  const term_ = segmentsOf(term);
  if (value_.length === 0 || term_.length === 0) return undefined;

  // `app/about-us/*` is the files of that folder and no deeper: the wildcard is
  // the file, so what precedes it has to be where the file actually sits,
  // rather than somewhere above it. `app/about-us/` keeps the wildcard's job
  // for itself and means everything underneath.
  if (term_[term_.length - 1] === '*') {
    const dirs = value_.slice(0, -1);
    return tails(dirs, term_.slice(0, -1)) ? dirs.join('/') : undefined;
  }
  return runAt(value_, term_);
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

/**
 * The recorded path down to the last segment the term named, when the term
 * appears in it entire, in order and unbroken.
 *
 * Either list may be the longer one. A caller pasting an absolute path holds
 * more segments than a run that recorded its files relative to the repository,
 * and the recorded path is then the whole of what was named.
 */
function runAt(value_: readonly string[], term_: readonly string[]): string | undefined {
  if (term_.length <= value_.length) {
    for (let from = 0; from + term_.length <= value_.length; from += 1) {
      let all = true;
      for (let at = 0; at < term_.length && all; at += 1) all = alike(term_[at]!, value_[from + at]!);
      if (all) return value_.slice(0, from + term_.length).join('/');
    }
    return undefined;
  }
  for (let from = 0; from + value_.length <= term_.length; from += 1) {
    let all = true;
    for (let at = 0; at < value_.length && all; at += 1) all = alike(value_[at]!, term_[from + at]!);
    if (all) return value_.join('/');
  }
  return undefined;
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

/**
 * The places, with the same place named twice folded into one.
 *
 * A run may record a file both absolutely, as the build host saw it, and
 * relative to the repository, and those are one file written two ways rather
 * than two coordinates. One place being the tail of another is what that looks
 * like from here, and it is also the only safe reading of it: `src/x/y.tsx` and
 * `/build/42/src/x/y.tsx` can only be the same file, while
 * `apps/web/Badge.tsx` and `apps/admin/Badge.tsx` are tails of nothing
 * and stay two.
 */
function distinct(places: Iterable<string>): readonly string[] {
  const kept: string[][] = [];
  for (const place of places) {
    const segments = place.split('/');
    let merged = false;
    for (let at = 0; at < kept.length && !merged; at += 1) {
      const held = kept[at]!;
      const short = held.length <= segments.length ? held : segments;
      const long = held.length <= segments.length ? segments : held;
      let tail = true;
      for (let back = 1; back <= short.length && tail; back += 1) {
        if (short[short.length - back] !== long[long.length - back]) tail = false;
      }
      if (tail) {
        kept[at] = long;
        merged = true;
      }
    }
    if (!merged) kept.push(segments);
  }
  return kept.map((segments) => segments.join('/'));
}

/** A start point, resolved. `subjects` empty means it named nowhere. */
export interface Scope {
  /** As the caller typed it. */
  readonly from: string;
  /** Its paths, lowercased, deduplicated. Empty when the start point was refused. */
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

  if (terms.length === 0) {
    return { from, terms: [], subjects: new Set<string>(), at: [], unmatched: [], refused: 'no start point was said' };
  }

  // Only the files a subject was seen in can answer a path. The other place
  // fields — the id, the component a subject is an example of, the components
  // it holds, who mounted them, the regions it entered — are names, and a name
  // is not a location.
  const files = index.entries.filter((entry) => entry.field === 'files');

  const at: string[] = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  let held: Set<string> | undefined;

  for (const term of terms) {
    const here = new Set<string>();
    const places = new Set<string>();
    for (const entry of files) {
      const place = resolves(entry.value, term);
      if (place === undefined) continue;
      here.add(entry.subject);
      places.add(place);
    }
    const where = distinct(places);
    if (where.length === 0) unmatched.push(term);
    // A width the caller asked for resolves to one place however much sits
    // under it. Two places means the name landed twice, in file trees that have
    // nothing to do with each other, and only the caller knows which was meant.
    else if (where.length > 1 && !term.includes('*')) {
      const named = where.slice(0, PLACES_NAMED).map((place) => `\`${place}\``).join(' and ');
      const rest = where.length > PLACES_NAMED ? ` and ${where.length - PLACES_NAMED} more` : '';
      ambiguous.push(`\`${term}\` is ${named}${rest}`);
    } else at.push(where[0]!);
    held = held === undefined ? here : new Set([...held].filter((subject) => here.has(subject)));
  }

  // Not found is a rejection, not an empty result. The caller handed over a
  // coordinate and this run does not have it: telling them so is a different
  // fact from telling them the place exists and holds nothing.
  if (unmatched.length > 0) {
    const named = unmatched.map((term) => `\`${term}\``).join(', ');
    return {
      from,
      terms,
      subjects: new Set<string>(),
      at,
      unmatched,
      refused: `${named} ${unmatched.length === 1 ? 'is' : 'are'} not found — no file of this run is there`,
    };
  }

  if (ambiguous.length > 0) {
    return {
      from,
      terms,
      subjects: new Set<string>(),
      at,
      unmatched,
      refused: `the start point is more than one place — ${ambiguous.join('; ')}`,
    };
  }

  return { from, terms, subjects: held ?? new Set<string>(), at, unmatched };
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
      "folder, `app/dispatch/` everything under it — and say it with enough of its parent to " +
      'be one place. To search everywhere, leave the start point out.'
    );
  }
  if (scope.subjects.size === 0) {
    return (
      `Nothing was searched of ${indexed} subject(s): its places hold no subject in common. ` +
      'A start point is a hard boundary, so no answer is given from outside it; widen it or ' +
      'leave it out.'
    );
  }
  return (
    `Searched ${scope.subjects.size} of ${indexed} subject(s), those recorded in a file at ` +
    `${scope.at.map((place) => `\`${place}\``).join(' and ')}. Rarity is counted inside that ` +
    'scope, so a word common to this area is worth nothing here even when the suite at large ' +
    'barely says it.'
  );
}
