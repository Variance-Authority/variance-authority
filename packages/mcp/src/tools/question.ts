import { lower } from './locate-index.js';

/**
 * A question read as what it asks for, what it asks near, and where.
 *
 * Splitting at the relation word is the whole of it: everything in front names
 * the thing wanted, everything behind names what it sits by and the surface it
 * sits on. There is no grammar here and deliberately none — a reader that
 * parsed English would be right more often and wrong in ways nobody could
 * predict, and this one is wrong in exactly one way, which the answer prints.
 */
/** A spatial relation, and the words that mean it. Closed, and printed when used. */
export type Relation = 'beneath' | 'above' | 'right of' | 'left of' | 'inside' | 'beside';

const RELATIONS: ReadonlyMap<string, Relation> = new Map([
  ['under', 'beneath'],
  ['underneath', 'beneath'],
  ['beneath', 'beneath'],
  ['below', 'beneath'],
  ['above', 'above'],
  ['over', 'above'],
  ['atop', 'above'],
  ['inside', 'inside'],
  ['within', 'inside'],
  ['beside', 'beside'],
  ['near', 'beside'],
  ['next', 'beside'],
]);

/**
 * Words that say what somebody means to *do*, not what they mean to find.
 *
 * A question arrives as an instruction — *change the warning underneath …* —
 * and the verb at the front names no landmark on any screen. Closed and short:
 * a longer list starts deciding what counts as a noun, which is a grammar, and
 * a grammar is the thing this file is built to avoid.
 */
const INTENT: ReadonlySet<string> = new Set([
  'change', 'fix', 'update', 'edit', 'move', 'remove', 'delete', 'add', 'adjust',
  'tweak', 'rename', 'restyle', 'reword', 'show', 'hide', 'find', 'where', 'is',
]);

const FILLER: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'on', 'in', 'of', 'to', 'at', 'for', 'and', 'with', 'that', 'it', 'its',
]);

/** What a question was read as, so an answer can be checked against it. */
export interface Asked {
  readonly relation?: Relation;
  /** Words naming the thing being looked for. */
  readonly target: readonly string[];
  /** Words naming what it sits by, and the surface it sits on. Used for both. */
  readonly anchor: readonly string[];
}

/**
 * A question split at its relation.
 *
 * Everything before the relation word names the target; everything after it
 * names the anchor *and* the surface, and is deliberately not split further.
 * "the carrier field on the dispatch drawer" is one phrase used twice: all of
 * it chooses which surface, and the part of it that matches a landmark chooses
 * which landmark. Separating them would need a grammar, and the phrase is
 * already doing both jobs correctly without one.
 */
export function readQuestion(question: string): Asked {
  const words = question
    .split(/\s+/)
    .map((word) => lower(word).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter((word) => word !== '');

  let at = -1;
  let relation: Relation | undefined;
  for (let index = 0; index < words.length; index += 1) {
    const found = RELATIONS.get(words[index]!);
    if (found !== undefined) {
      at = index;
      relation = found;
      break;
    }
  }

  const keep = (list: readonly string[]) =>
    list.filter((word) => !INTENT.has(word) && !FILLER.has(word));

  if (relation === undefined) return { target: [], anchor: keep(words) };
  return { relation, target: keep(words.slice(0, at)), anchor: keep(words.slice(at + 1)) };
}
