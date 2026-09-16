import type { RunReport } from '@variance-authority/report';
import { entriesMatching, indexOf, lower, partsOf, type LocateField } from './locate-index.js';

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
        .map((word) => lower(word).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
        .filter((word) => word !== ''),
    ),
  ];

  const unmatched: string[] = [];
  let held: Set<string> | undefined;
  for (const term of terms) {
    const parts = partsOf(term);
    if (parts.length === 0) continue;

    const here = new Set<string>();
    for (const id of entriesMatching(index, parts)) {
      const entry = index.entries[id]!;
      if (!PLACE_FIELDS.has(entry.field)) continue;
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
        : `${scope.unmatched.map((term) => `\`${term}\``).join(', ')} names no id, component, ` +
          'creator, file or region in this run';
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
