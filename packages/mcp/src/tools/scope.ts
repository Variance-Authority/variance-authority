import type { RunReport } from '@variance-authority/report';
import { entriesMatching, indexOf, lower, partsOf, stem, type LocateField } from './locate-index.js';

/**
 * Where to look, said as a place rather than as a thing.
 *
 * A description and a start point are two different kinds of word and a reader
 * that mixes them answers neither well. *The overdue badge* says what a person
 * is looking at; *billing* says which part of the application they are standing
 * in. Folded into one query the second is just three more words to match, and
 * the suite's billing screens compete with every other screen that happens to
 * say `billing` on it — which on a real application is most of them, because a
 * product says its own name everywhere.
 *
 * Kept apart, the start point does the one thing a description cannot: it
 * removes subjects. That matters twice over. Fewer rows is the small half. The
 * large half is that rarity is a count over subjects, so counting it inside the
 * scope changes what the words are worth — a word every screen in the
 * application says is still worth nothing, and a word every screen *in this
 * area* says is worth nothing here, which is a different and more useful
 * statement.
 *
 * Measured on two corpora that persist, three hundred questions each, the
 * questions taken from the record and the start word typed by the caller:
 *
 * ```
 *                 subjects  scope  narrower  first hit      within three
 * 2019 app        166       76     2.2x      52 → 75        100 → 157
 * component lib   4,705     130    36.1x     30 → 48        50 → 74
 * ```
 *
 * A start point naming somewhere the subject is not returned it at no rank on
 * every one of those six hundred questions. That is the property worth having
 * and the reason the scope is printed in the header with its size: a wrong
 * start point fails visibly and emptily, rather than moving a confident wrong
 * answer to the top.
 */

/**
 * The fields that say where the code is. A start point is matched against these
 * and never against `names`, `text`, `roles` or `tokens`.
 *
 * The division is the whole idea. `text` would let *billing* be answered by a
 * button labelled *Billing* on the account screen, which is the thing being
 * looked for wearing the clothes of the place to look — exactly the confusion
 * separating the two arguments exists to prevent. What remains are the names a
 * codebase organises itself under: the id, the component a subject is the
 * example of, the components it holds, who mounted them, the files that declare
 * them, and the regions its journey entered.
 */
export const PLACE_FIELDS: ReadonlySet<LocateField> = new Set<LocateField>([
  'id',
  'example',
  'components',
  'createdBy',
  'files',
  'regions',
]);


/**
 * A path as the segments a person means: separators of either slash, empty
 * pieces dropped, extension off, lowercased.
 */
function segmentsOf(path: string): readonly string[] {
  return path
    .split(/[/\\]/)
    .filter((segment) => segment !== '')
    .map((segment) => lower(segment).replace(/\.[a-z0-9]+$/, ''));
}

/**
 * A start point that is itself a path, matched as a path rather than as a word.
 *
 * The most exact thing a caller can hand over is the file already open in front
 * of them, and it was the one start point that failed: a path carries no
 * whitespace, so it arrived here whole, named no single segment, and the answer
 * called the caller's own coordinate an unknown word.
 *
 * It is read as a run of segments that has to appear entire, in order and
 * unbroken, in the recorded path — which is the same statement for a file and
 * for a directory, and the reason it is put that way. `Activity/Activity.tsx`
 * names the file a run recorded as `src/pages/Activity/Activity.tsx`;
 * `src/pages/Activity` names every file under it; the absolute path an editor
 * hands over names the file too, because the shorter run may be either side.
 * A `*` stands for one segment a caller does not want to name, and a trailing
 * one is the file: `app/about-us/*` is the files of that folder and nothing
 * deeper, while `app/about-us/` is everything underneath it. The narrower of
 * the two is the one that has to be said, because a caller who says nothing
 * about depth means any.
 *
 * What it will not do is join two absolute paths of the same depth under
 * different roots — a build host's checkout and the caller's — which share a
 * tail and disagree above it. Nothing in a run says which of its leading
 * segments are the root, and a rule loose enough to join those would join
 * `apps/web/…/Button.tsx` to `apps/admin/…/Button.tsx`. On the corpora measured
 * it costs nothing: every recorded path answers itself, and the files a rooted
 * run records absolutely it also records unrooted.
 */
function pathRuns(value: string, term: string): boolean {
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

/** One segment against one, with the wildcard and the stem both sides use. */
function alike(mine: string, theirs: string): boolean {
  return mine === '*' || theirs === '*' || mine === theirs || stem(mine) === stem(theirs);
}

/** A start point, resolved. `subjects` empty means it named nowhere. */
export interface Scope {
  /** As the caller typed it. */
  readonly from: string;
  /** Its words after punctuation, lowercased, deduplicated. */
  readonly terms: readonly string[];
  /** The subjects it names. */
  readonly subjects: ReadonlySet<string>;
  /** Words of it no subject holds in a place field. */
  readonly unmatched: readonly string[];
}

/**
 * The subjects a start point names: those whose place fields hold **every** one
 * of its words.
 *
 * Conjunctive, unlike the ranking beside it, and for the opposite reason. A
 * rank may be generous because being wrong costs one more call; a scope that
 * was generous would put back the subjects it exists to remove, and two words
 * in a start point are a caller narrowing deliberately rather than describing
 * more fully.
 *
 * A word carrying no letters or digits — punctuation a caller left in — is
 * skipped rather than emptying the scope, because it narrows nothing on
 * purpose. A word that is a real word and names nothing does empty it, and the
 * answer says which word did.
 */
export function scopeOf(report: RunReport, from: string): Scope {
  const index = indexOf(report);
  const terms = [
    ...new Set(
      from
        .split(/\s+/)
        // A trailing `*` or separator is a width the caller asked for, not
        // punctuation they left behind: `app/` is a folder and `app` is a word.
        // Everything else at either end goes.
        .map((word) => lower(word).replace(/^[^a-z0-9]+|[^a-z0-9*/\\]+$/g, ''))
        .filter((word) => word !== ''),
    ),
  ];

  const unmatched: string[] = [];
  let held: Set<string> | undefined;
  for (const term of terms) {
    // A term carrying a separator is a coordinate, not a word, and only a file
    // can answer it. The candidates are drawn on the last segment alone — the
    // one piece both sides hold whichever of them is rooted deeper — and the
    // tail comparison decides.
    const path = /[/\\]/.test(term);
    // The deepest segment the caller actually named — a wildcard names none, so
    // the prefilter steps back to the last one that does.
    const named = path ? [...segmentsOf(term)].reverse().find((piece) => piece !== '*') : term;
    const parts = partsOf(named ?? '');
    if (parts.length === 0) continue;

    const here = new Set<string>();
    for (const id of entriesMatching(index, parts)) {
      const entry = index.entries[id]!;
      if (!PLACE_FIELDS.has(entry.field)) continue;
        // A path answers only files, and a word answers anything but. A file
      // name is not unique and is not a place: `I18nProvider` says which
      // component, `src/core/Containers/I18nProvider.tsx` says which file.
      if (path ? entry.field !== 'files' || !pathRuns(entry.value, term) : entry.field === 'files') {
        continue;
      }
      here.add(entry.subject);
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
  if (scope.terms.length === 0) {
    return `Nothing left of the start point \`${scope.from}\` after its punctuation.`;
  }
  if (scope.subjects.size === 0) {
    const why =
      scope.unmatched.length === 0
        ? 'no subject holds all of them at once'
        : `${scope.unmatched.map((term) => `\`${term}\``).join(', ')} names nothing in this ` +
          `run: ${scope.unmatched.some((term) => /[/\\]/.test(term)) ? 'no file was seen at that path' : 'no id, component, creator or region goes by that word'}`;
    return (
      `Start point \`${scope.from}\` names no subject of ${indexed}: ${why}. ` +
      'Nothing below is scoped; a start point is matched against where code is, never against ' +
      'what a subject shows.'
    );
  }
  return (
    `Searched ${scope.subjects.size} of ${indexed} subject(s), those \`${scope.from}\` names. ` +
    'Rarity is counted inside that scope, so a word common to this area is worth nothing here ' +
    'even when the suite at large barely says it.'
  );
}
