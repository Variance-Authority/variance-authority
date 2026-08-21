import { pointerShape, pointerToken, type CapturedValue } from '../format/value.js';
import { digestCombine, digestString, type Digest } from '../format/hash.js';

/**
 * Two values become deltas — and no verdict (spec 0031).
 *
 * `compare/diff` does this for two rendered documents. This is the same shape at
 * the floor of the subject list, where there is no schema, no position and
 * therefore nothing that can decide whether a caller survives. What is left is
 * real and smaller: which paths appeared, which vanished, which changed type,
 * and which changed value.
 *
 * ## Why no library
 *
 * The untyped case is usually reached for `jsondiffpatch`, whose value is a
 * longest-common-subsequence match over arrays and an optional text diff. Neither
 * is wanted here: `ValueShaping.arrayKey` turns an array into an object
 * before this function ever sees it, which is a better answer than guessing at
 * moves, and a text diff of a leaf is a picture of a difference rather than a
 * name for it. What remains is arithmetic, and `core` carries no dependency.
 *
 * ## What a delta does not carry
 *
 * No values. The two canonical texts are the baseline and the candidate and a
 * person reads them side by side; a delta that quoted them would put a payload
 * into the docket, the changelog and every record that accumulates — which is a
 * retention decision this project must not make on an adopter's behalf.
 */

export type ValueChange = 'added' | 'removed' | 'type-changed' | 'value-changed';

export interface ValueDelta {
  readonly change: ValueChange;

  /** RFC 6901 pointer to what moved. The empty string is the whole value. */
  readonly pointer: string;

  /**
   * The shape of this difference, with position and values removed.
   *
   * Taken over the dialect, the *wildcarded* pointer and the kind of change — so
   * the same edit at row 4 and at row 900 is one shape happening twice, and two
   * subjects carrying it can be settled by one decision. Deliberately not over
   * the subject: a fingerprint that named its subject could never group two.
   */
  readonly fingerprint: Digest;
}

/** What kind of thing a canonical value is. A change between two of these is structural. */
type ValueKind = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

/**
 * Every difference between two shaped values, one delta per site.
 *
 * A subtree that appeared, vanished or changed kind is **one** delta at its root
 * and is not descended into. A removed object reported as one removal per leaf is
 * the forty-red-rectangles failure in a medium where nobody can see it at a
 * glance, and the root is the thing a person would fix.
 */
export function compareValues(
  baseline: CapturedValue,
  candidate: CapturedValue,
): readonly ValueDelta[] {
  if (baseline.dialect !== candidate.dialect) {
    throw new Error(
      `cannot compare a ${baseline.dialect} value against a ${candidate.dialect} one`,
    );
  }
  if (baseline.recipe !== candidate.recipe) {
    throw new Error(
      `these values were shaped under different rules (${baseline.recipe} and ` +
        `${candidate.recipe}), so a difference between them may be the rules and not the value`,
    );
  }

  const keyed = (baseline.keyed ?? []).join(' ');
  if (keyed !== (candidate.keyed ?? []).join(' ')) {
    throw new Error(
      'these values keyed different arrays, so a row named by its identity on one side is ' +
        'named by its position on the other',
    );
  }

  const found: ValueDelta[] = [];
  walk(parse(baseline), parse(candidate), '', baseline.dialect, baseline.keyed ?? [], found);

  // Code-unit ordering. Never `localeCompare`: this ordering reaches a report.
  return found.sort((left, right) => {
    if (left.pointer !== right.pointer) return left.pointer < right.pointer ? -1 : 1;
    if (left.change === right.change) return 0;
    return left.change < right.change ? -1 : 1;
  });
}

/**
 * The fingerprint a delta would carry, without having to produce the delta.
 *
 * Exported so that a rule scoped to a shape is written by copying a digest out of
 * a report rather than by deriving one — the same property region fingerprints
 * have, for the same reason.
 */
export function fingerprintOfValueDelta(
  dialect: string,
  pointer: string,
  change: ValueChange,
  keyed: readonly string[] = [],
): Digest {
  const site = digestCombine('value-site/v1', [
    digestString(dialect),
    digestString(pointerShape(pointer, keyed)),
  ]);
  return digestCombine('value-change/v1', [site, digestString(change)]);
}

function parse(value: CapturedValue): unknown {
  try {
    return JSON.parse(value.text);
  } catch (error) {
    throw new Error(`a ${value.dialect} value at ${value.digest} is not readable`, {
      cause: error,
    });
  }
}

function kindOf(value: unknown): ValueKind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as ValueKind;
}

function walk(
  before: unknown,
  after: unknown,
  pointer: string,
  dialect: string,
  keyed: readonly string[],
  found: ValueDelta[],
): void {
  const was = kindOf(before);
  const now = kindOf(after);

  const record = (change: ValueChange, at: string): void => {
    found.push({
      change,
      pointer: at,
      fingerprint: fingerprintOfValueDelta(dialect, at, change, keyed),
    });
  };

  if (was !== now) {
    record('type-changed', pointer);
    return;
  }

  if (was === 'array') {
    const olds = before as readonly unknown[];
    const news = after as readonly unknown[];
    for (let index = 0; index < Math.max(olds.length, news.length); index += 1) {
      const at = `${pointer}/${index}`;
      if (index >= news.length) record('removed', at);
      else if (index >= olds.length) record('added', at);
      else walk(olds[index], news[index], at, dialect, keyed, found);
    }
    return;
  }

  if (was === 'object') {
    const olds = before as Record<string, unknown>;
    const news = after as Record<string, unknown>;
    for (const key of new Set([...Object.keys(olds), ...Object.keys(news)])) {
      const at = `${pointer}/${pointerToken(key)}`;
      if (!(key in news)) record('removed', at);
      else if (!(key in olds)) record('added', at);
      else walk(olds[key], news[key], at, dialect, keyed, found);
    }
    return;
  }

  if (before !== after) record('value-changed', pointer);
}
