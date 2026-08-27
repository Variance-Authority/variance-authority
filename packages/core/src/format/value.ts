import { canonicalize, type CanonicalValue } from './canonical.js';
import { digestCombine, digestString, type Digest } from './hash.js';

/**
 * A value that was never rendered, as something a run can compare (spec 0031).
 *
 * The third material. It carries **text**, not a parse tree, for the reason the
 * raster arm carries bytes: every reader that understands a dialect is somebody
 * else's dependency, `core` carries none, and a stored parse is a parse that
 * reader's next version disagrees with. The text is what the digest was taken
 * over, what a baseline holds, and what a person reads in a pull request.
 *
 * The canonical form is `canonicalize`, unchanged and unwrapped — sorted keys,
 * portable number formatting, `undefined` omitted rather than nulled, and a
 * refusal on a non-finite number. What this module adds is the *shaping* that
 * has to happen before it, because two of the three rules below decide whether
 * the comparison downstream is readable or useless.
 */

/**
 * The version of the shaping rules, and part of every value digest.
 *
 * Bumping it invalidates stored value baselines deliberately: a text produced
 * under different rules is not the same reading of the same subject, and a
 * digest that could not tell the difference would report a rule change as a
 * subject that did not move.
 */
export const VALUE_RECIPE = 'value/1';

/** What a dropped value becomes. Present in the text, never compared. */
export const DROPPED = '[dropped]';

/** What a value capture looks like once it has been shaped. */
export interface CapturedValue {
  /** How to read the text: `json`, `openapi`, `graphql`, `route-table`. */
  readonly dialect: string;

  /** The canonical serialization — byte for byte what the digest was taken over. */
  readonly text: string;

  readonly digest: Digest;

  /** The shaping rules this text was produced under. {@link VALUE_RECIPE}. */
  readonly recipe: string;

  /**
   * The arrays this text was keyed by, as wildcarded pointers.
   *
   * A keyed array is an object whose members are named by a row's identity, so
   * `/rows/checkout` is a *row* and `/rows/total` might not be. Carried because
   * nothing downstream can tell those apart by looking, and a comparison that
   * guessed would either group two unrelated members or fail to group the same
   * edit made to two rows.
   */
  readonly keyed?: readonly string[];

  /** What emitted it. The environment key for this material, when there is one. */
  readonly generator?: { readonly name: string; readonly version: string };
}

/**
 * What to do to a value before it is canonicalized.
 *
 * Every key is a JSON Pointer (RFC 6901) into the value. A `-` token matches any
 * array index, so `/items/-/updatedAt` names that member of every item — the
 * concrete pointer and the wildcarded one are both offered to the rules, so a
 * literal `/items/0/updatedAt` still names exactly one.
 */
export interface ValueShaping {
  /**
   * Paths whose values are volatile.
   *
   * Recorded as {@link DROPPED} rather than removed, because *this key is here
   * and I chose not to look at it* and *this key is gone* are different facts and
   * a comparison must not collapse them.
   */
  readonly drop?: readonly string[];

  /** Paths whose values become a stable token of the adopter's choosing. */
  readonly replace?: Readonly<Record<string, string>>;

  /**
   * For an array of records, the member that identifies a row.
   *
   * Load-bearing, and not a convenience. An array compared by index reports a row
   * inserted at the top of a two-thousand-row list as two thousand rows having
   * changed — the same failure as forty red screenshots for one edit, in a medium
   * where nobody can see it at a glance. Keyed, the array becomes an object, so
   * order stops being a fact about it and an insertion is one addition.
   */
  readonly arrayKey?: Readonly<Record<string, string>>;
}

export interface ShapeValueOptions extends ValueShaping {
  /** Defaults to `json`. */
  readonly dialect?: string;
  readonly generator?: { readonly name: string; readonly version: string };
}

/**
 * Shape a value, canonicalize it, and address it by content.
 *
 * Throws on anything that cannot be a value rather than encoding it: a function,
 * a `Date`, a `bigint`, a non-finite number. Each refusal names the JSON Pointer
 * where it was found, because the alternative — `JSON.stringify`'s — is to drop
 * a function silently, which reads downstream as a key that was removed.
 */
export function shapeValue(value: unknown, options: ShapeValueOptions = {}): CapturedValue {
  const shaped = shapeNode(value, '', options);
  const text = canonicalize(shaped);

  const keyed = Object.keys(options.arrayKey ?? {})
    .map((pointer) => pointerShape(pointer))
    .sort();

  return {
    dialect: options.dialect ?? 'json',
    text,
    digest: digestCombine('value/v1', [digestString(text), digestString(VALUE_RECIPE)]),
    recipe: VALUE_RECIPE,
    ...(keyed.length === 0 ? {} : { keyed }),
    ...(options.generator === undefined ? {} : { generator: options.generator }),
  };
}

/** RFC 6901: `~` becomes `~0` and `/` becomes `~1`, in that order. */
export function pointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * The pointer with every row identity replaced by `-`.
 *
 * Two things: it is what a wildcard rule is matched against, and it is what a
 * change's fingerprint is taken over — so the same kind of edit at row 4 and at
 * row 900 is one shape happening twice rather than two findings.
 *
 * An index is a row identity by spelling. A **keyed** array's members are named
 * instead, and no spelling can distinguish those from an ordinary object's keys —
 * so `keyed` is passed in from the capture that declared it, and only the segment
 * immediately below a keyed array is wildcarded.
 */
export function pointerShape(pointer: string, keyed: readonly string[] = []): string {
  const shaped = pointer.replace(/\/\d+(?=\/|$)/g, '/-');

  return keyed.reduce((current, array) => {
    if (!current.startsWith(`${array}/`)) return current;
    const rest = current.slice(array.length + 1);
    const cut = rest.indexOf('/');
    return cut === -1 ? `${array}/-` : `${array}/-${rest.slice(cut)}`;
  }, shaped);
}

function matches(rules: readonly string[], pointer: string): boolean {
  return rules.includes(pointer) || rules.includes(pointerShape(pointer));
}

function ruleFor<T>(rules: Readonly<Record<string, T>> | undefined, pointer: string): T | undefined {
  if (rules === undefined) return undefined;
  return rules[pointer] ?? rules[pointerShape(pointer)];
}

function shapeNode(value: unknown, pointer: string, options: ValueShaping): CanonicalValue {
  if (matches(options.drop ?? [], pointer)) return DROPPED;

  const replaced = ruleFor(options.replace, pointer);
  if (replaced !== undefined) return replaced;

  if (value === null) return null;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new RangeError(
          `${describe(pointer)} is ${String(value)}, which no digest may encode: a non-finite ` +
            'number means the thing that produced it failed, and hashing it would give a broken ' +
            'reading a stable identity',
        );
      }
      return value;
    case 'object':
      break;
    default:
      throw new TypeError(
        `${describe(pointer)} is a ${typeof value}, which is not a value. ` +
          'Serializing it would drop it silently, and a key that vanished from the text is ' +
          'read downstream as a key that was removed.',
      );
  }

  if (Array.isArray(value)) return shapeArray(value, pointer, options);

  if (opaque(value)) {
    throw new TypeError(
      `${describe(pointer)} is a ${nameOf(value)}, which is not a value. Its state is not in ` +
        'its own enumerable keys, so it would serialize to `{}` and two different ones would ' +
        'compare as unchanged. Convert it where it is produced — an ISO string, a number, a ' +
        'plain object — so the text says what was compared.',
    );
  }

  const shaped: Record<string, CanonicalValue> = {};
  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    if (member === undefined) continue;
    shaped[key] = shapeNode(member, `${pointer}/${pointerToken(key)}`, options);
  }
  return shaped;
}

/**
 * Whether an object keeps its state somewhere `Object.entries` cannot reach.
 *
 * A `Date`, a `Map`, a `Set`, a `URL`, a `RegExp` — each has no own enumerable
 * key, so the object branch below produces `{}` for every one of them. That is
 * the exact harm the function and bigint refusals exist to prevent, arriving
 * through the one `typeof` that does not name it: a timestamp that moved a year
 * and a timestamp that did not both address to the digest of `{}`, and the run
 * that compares them reports unchanged.
 *
 * Emptiness alone is not the test — `{}` is a value, and an adopter may legitimately
 * snapshot one. The test is emptiness in something that is not a plain object,
 * which is what says the state went somewhere else. An instance carrying its own
 * fields serializes those fields and is left alone, exactly as `JSON.stringify`
 * would leave it.
 */
function opaque(value: object): boolean {
  if (Object.keys(value).length > 0) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype !== Object.prototype && prototype !== null;
}

/** What to call the thing in the refusal, so the message names the type at hand. */
function nameOf(value: object): string {
  const named = value.constructor?.name;
  return typeof named === 'string' && named.length > 0 ? named : 'object';
}

function shapeArray(
  items: readonly unknown[],
  pointer: string,
  options: ValueShaping,
): CanonicalValue {
  const key = ruleFor(options.arrayKey, pointer);
  if (key === undefined) {
    return items.map((item, index) => shapeNode(item, `${pointer}/${index}`, options));
  }

  const keyed: Record<string, CanonicalValue> = {};
  items.forEach((item, index) => {
    const at = `${pointer}/${index}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new TypeError(`${describe(at)} is keyed by \`${key}\` and is not a record`);
    }
    const member = (item as Record<string, unknown>)[key];
    if (typeof member !== 'string' && typeof member !== 'number') {
      throw new TypeError(`${describe(at)} has no \`${key}\` to be identified by`);
    }
    const identity = String(member);
    if (identity in keyed) {
      throw new Error(
        `${describe(pointer)} has two rows with \`${key}\` of ${identity}. A key that does not ` +
          'identify a row would silently take the later one, making the earlier row invisible.',
      );
    }
    keyed[identity] = shapeNode(item, `${pointer}/${pointerToken(identity)}`, options);
  });
  return keyed;
}

function describe(pointer: string): string {
  return pointer === '' ? 'the value' : `the value at ${pointer}`;
}
