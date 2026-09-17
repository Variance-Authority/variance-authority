import { lower } from './locate-index.js';

/**
 * What a question asks for, what it asks near, and where.
 *
 * Read off named arguments and never out of a sentence. An earlier version of
 * this file split a free-text query at the first spatial word it recognised —
 * `under`, `above`, `inside` — which is a grammar, and a grammar is wrong in
 * ways the caller cannot predict: a suite with an *Under review* badge, a *Show
 * more* link or an *Inside sales* tab had those words taken off it as syntax.
 *
 * Marking the word instead — `$under` — moves the failure rather than removing
 * it: it is still one string carrying structure, still positional, and still
 * something the caller has to escape around. The reader here is an agent
 * filling in fields, and a field is the form it already has. So the relation is
 * the name of the argument, which is why there are six of them: an argument
 * whose name is the relation cannot be paired with the wrong one.
 */

/** A spatial relation, and the argument that names it. Closed. */
export type Relation = 'beneath' | 'above' | 'right of' | 'left of' | 'inside' | 'beside';

const RELATIONS: ReadonlyMap<string, Relation> = new Map([
  ['under', 'beneath'],
  ['above', 'above'],
  ['leftOf', 'left of'],
  ['rightOf', 'right of'],
  ['inside', 'inside'],
  ['beside', 'beside'],
]);

/** The argument names, for a schema to declare and a refusal to list. */
export const RELATION_ARGUMENTS: readonly string[] = [...RELATIONS.keys()];

/** Where the surface is named. Its own argument, because it is its own fact. */
export const SURFACE_ARGUMENT = 'on';

/**
 * Ten function words and nothing else. Closed, in code, because a stoplist is a
 * rule about the query and a rule is printed, not tuned.
 *
 * Function words only, and that is the whole test for admitting one: `the` is
 * never the name of anything, and every word that could be — a verb, or a
 * preposition a product uses as a label — stays in, whatever it costs a rank.
 */
export const STOPLIST: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'in', 'on', 'of', 'with', 'and', 'for', 'to',
]);

/** What a question was read as, so an answer can be checked against it. */
export interface Asked {
  readonly relation?: Relation;
  /** Words naming the thing being looked for. */
  readonly target: readonly string[];
  /** Words naming what it sits by. */
  readonly anchor: readonly string[];
  /** Words naming the surface the two are on. Empty when the caller named none. */
  readonly surface: readonly string[];
}

/** One phrase as words: lowercased, stripped of surrounding punctuation, stoplist gone. */
export function wordsOf(phrase: string | undefined): readonly string[] {
  if (phrase === undefined) return [];
  return phrase
    .split(/\s+/)
    .map((word) => lower(word).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter((word) => word !== '' && !STOPLIST.has(word));
}

/** The one argument of a set that was said, or nothing. A blank is nothing said. */
function said(
  input: Readonly<Record<string, unknown>>,
  names: readonly string[],
): { readonly name: string; readonly phrase: string } | undefined {
  const given = names
    .map((name) => ({ name, value: input[name] }))
    .filter(
      (entry): entry is { name: string; value: string } =>
        typeof entry.value === 'string' && entry.value.trim() !== '',
    );

  // Two relations is a question with two answers, and picking one of them would
  // be the guessing the argument names exist to remove.
  if (given.length > 1) {
    throw new Error(
      `\`${given.map((entry) => entry.name).join('` and `')}\` were both said, and a thing sits ` +
        'in one relation to one anchor. Say one, and ask again for the other.',
    );
  }

  const one = given[0];
  return one === undefined ? undefined : { name: one.name, phrase: one.value };
}

/**
 * The arguments as one question.
 *
 * The anchor and the surface are separate because they are different facts and
 * only the caller knows both. The drawer and the field on it are each a
 * landmark; which of them the relation is measured from decides the answer, and
 * a reader given one phrase for both had to work that out from which reading
 * came out answerable. Named apart, there is nothing to work out.
 */
export function askedFor(query: string, input: Readonly<Record<string, unknown>>): Asked {
  const near = said(input, RELATION_ARGUMENTS);
  const surface = wordsOf(said(input, [SURFACE_ARGUMENT])?.phrase);

  if (near === undefined) {
    if (surface.length > 0) {
      throw new Error(
        `\`${SURFACE_ARGUMENT}\` names the surface a relation question is asked on, and no ` +
          `relation was said. Add one of \`${RELATION_ARGUMENTS.join('`, `')}\`, or ask for the ` +
          'words alone with `query`.',
      );
    }
    return { target: [], anchor: wordsOf(query), surface };
  }

  const anchor = wordsOf(near.phrase);
  if (anchor.length === 0) {
    throw new Error(
      `\`${near.name}\` names what the thing sits by, and nothing in it is a word to look for. ` +
        `Say what is there: \`{query: "warning", ${near.name}: "Carrier"}\`.`,
    );
  }

  return { relation: RELATIONS.get(near.name)!, target: wordsOf(query), anchor, surface };
}
