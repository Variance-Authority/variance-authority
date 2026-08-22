import type { AxisConfig, NamesConfig } from '../config-names.js';

/**
 * Breaking a subject id into the name it already is.
 *
 * ## The ability
 *
 * `story:checkout--dark-ff-on` is not a string. It is a checkout, dark, with the
 * flag on — a stem and two axes, written in the order the suite always writes
 * them. Given the grammar in `names` (`config-names.ts`), this reads that back
 * out: {@link readName} returns the stem and the axes it found, and
 * {@link nameIndex} puts every subject in a run at its coordinate, so the
 * neighbours of any one of them can be found.
 *
 * Nothing here decides anything. It answers *what is this name made of* and
 * *which subject is one step from it*; `variations.ts` is what does something
 * with the answer.
 *
 * ## Why this exists next to the prefix rule
 *
 * `namedParent` in `variations.ts` reads a name with no grammar at all: the
 * longest other subject id this one extends. That is right for a suite nobody
 * has configured, and it can only walk *outwards* — `checkout-dark` extends
 * `checkout`, so the parent is the shorter name.
 *
 * A great many suites are not shaped like that. Their baseline is spelled out
 * (`checkout--default`, not `checkout`), their axes have vocabularies (`green`,
 * `glass`), and the question worth asking is between two names of the same
 * length: what is the difference between the green one and the glass one. A
 * prefix cannot answer it, because neither name is a prefix of the other. A
 * vocabulary can: `green` is the base of its axis, so the glass one is one step
 * from it, and the step has a name to print.
 */

/**
 * The characters a name may be extended at.
 *
 * A value has to begin where the rest of the name ends, or `on` would be found
 * inside `london`. What makes a word an *axis* in a name is that it is a piece
 * of it, and a piece has a separator in front.
 */
export const BOUNDARY = new Set(['-', '_', '.', ':', '/', '+', ' ', '~']);

/** One axis a name was found to carry, and what it was set to. */
export interface NamedAxis {
  readonly axis: string;
  readonly value: string;
}

/** A subject id, read as the structure it is. */
export interface StructuralName {
  readonly id: string;

  /**
   * What is left when every axis is taken off the end.
   *
   * The thing the axes are axes *of* — `story:checkout` for both
   * `story:checkout--default` and `story:checkout--dark`. Two subjects are only
   * compared through this file when their stems are identical, because a
   * difference between two stems is two components, and no axis names it.
   */
  readonly stem: string;

  /** Every axis the name carries, in grammar order, as written. */
  readonly axes: readonly NamedAxis[];

  /**
   * The same list with base values dropped: where this subject actually sits.
   *
   * `checkout--default` and `checkout` are one coordinate, which is the whole
   * reason a base value exists. Kept beside {@link axes} rather than replacing
   * it, because what the name *said* is what a report has to quote back.
   */
  readonly coordinate: readonly NamedAxis[];
}

/** The one axis a step crosses, and what it crosses between. */
export interface Step {
  readonly axis: string;
  readonly from: string;
  readonly to: string;
}

/** Every subject in a run, at its coordinate. */
export interface NameIndex {
  readonly grammar: NamesConfig;
  /** By subject id. */
  readonly names: ReadonlyMap<string, StructuralName>;
  /** By coordinate: the subjects that sit at it, in plan order. */
  readonly at: ReadonlyMap<string, readonly string[]>;
}

/** What a walk toward the base found, or why it refused to answer. */
export type StructuralLink =
  | { readonly ok: true; readonly parent: string; readonly step: Step }
  | { readonly ok: false; readonly because: string };

/**
 * Read a subject id as a stem and the axes it carries.
 *
 * Matched from the end, and through the grammar in reverse, because axes are
 * appended in order and any of them may be absent: `checkout-ff-on` is the
 * checkout with the flag on and nothing said about the scheme. Working
 * backwards, each axis is offered the tail and takes it or does not, so an
 * absent axis costs nothing and a present one cannot be read out of order.
 *
 * The longest matching value wins, so an axis listing both `on` and `ff-on`
 * reads `ff-on` as one word rather than finding `on` inside it.
 */
export function readName(id: string, grammar: NamesConfig): StructuralName {
  const axes: NamedAxis[] = [];
  let rest = id;

  for (let index = grammar.axes.length - 1; index >= 0; index--) {
    const axis = grammar.axes[index]!;
    const value = longestSuffix(rest, axis.values);
    if (value === undefined) continue;
    axes.unshift({ axis: axis.axis, value });
    rest = trimTail(rest.slice(0, rest.length - value.length));
  }

  return {
    id,
    stem: rest,
    axes,
    coordinate: axes.filter((entry) => entry.value !== baseOf(grammar, entry.axis)),
  };
}

/**
 * Put every subject in a run at its coordinate.
 *
 * Built once per run rather than per subject: three hundred names asked three
 * hundred questions about their neighbours is the same three hundred readings
 * either way, and the map is what makes each question a lookup.
 */
export function nameIndex(ids: Iterable<string>, grammar: NamesConfig): NameIndex {
  const names = new Map<string, StructuralName>();
  const at = new Map<string, string[]>();

  for (const id of ids) {
    const name = readName(id, grammar);
    names.set(id, name);
    const key = keyOf(name.stem, name.coordinate);
    const here = at.get(key);
    if (here === undefined) at.set(key, [id]);
    else here.push(id);
  }

  return { grammar, names, at };
}

/**
 * The subject this one is one step from, walking its last axis toward the base.
 *
 * The last axis rather than any of them, so a link is one axis and the
 * difference across it is worth reading: `checkout-dark-ff-on` is measured
 * against `checkout-dark` and not against `checkout`. Toward the base rather
 * than away, so the chain has a direction and the pair does not depend on which
 * of the two was asked.
 *
 * The nearest neighbour this run actually planned wins, working back along the
 * vocabulary and ending at the coordinate with the axis dropped altogether.
 * `checkout--glass` prefers `checkout--green` to `checkout--default` when both
 * exist, because the shorter step is the one whose difference is one thing.
 *
 * Returns nothing when the name carries no axis: a stem is not a variation of
 * anything, and neither is a subject whose grammar found nothing in it.
 * Ambiguity is refused rather than resolved by order — two subjects at one
 * coordinate is a run where a name means two subjects, and picking either would
 * attach a difference to the wrong one.
 */
export function structuralParent(id: string, index: NameIndex): StructuralLink | undefined {
  const name = index.names.get(id);
  if (name === undefined || name.coordinate.length === 0) return undefined;

  const last = name.coordinate.at(-1)!;
  const axis = index.grammar.axes.find((entry) => entry.axis === last.axis);
  if (axis === undefined) return undefined;

  const held = name.coordinate.slice(0, -1);

  // From the value below this one back to the base. The base is never in a
  // coordinate — a name at its base is a name without the axis — so the last
  // step of the walk, `values[0]`, is the axis dropped.
  for (let below = axis.values.indexOf(last.value) - 1; below >= 0; below--) {
    const value = axis.values[below]!;
    const coordinate = below === 0 ? held : [...held, { axis: last.axis, value }];
    const others = (index.at.get(keyOf(name.stem, coordinate)) ?? []).filter(
      (other) => other !== id,
    );

    if (others.length === 1) {
      const step = { axis: last.axis, from: value, to: last.value };
      return { ok: true, parent: others[0]!, step };
    }
    if (others.length > 1) {
      return {
        ok: false,
        because:
          `its name puts it one step from \`${axis.axis}\` at \`${value}\`, and ` +
          `${others.length} subjects in this run are named that: ` +
          others.map((other) => `\`${other}\``).join(', '),
      };
    }
  }

  return undefined;
}

/** What the axis is when nobody says otherwise. */
function baseOf(grammar: NamesConfig, axis: string): string | undefined {
  return grammar.axes.find((entry: AxisConfig) => entry.axis === axis)?.values[0];
}

function keyOf(stem: string, coordinate: readonly NamedAxis[]): string {
  return `${stem} ${coordinate.map((entry) => `${entry.axis}=${entry.value}`).join('|')}`;
}

/**
 * The longest value this name ends with, at a separator.
 *
 * Something has to remain in front of it: a subject whose whole id is `dark` is
 * a subject named after an axis, and reading it as an axis with an empty stem
 * would put it beside every other stemless name in the run.
 */
function longestSuffix(rest: string, values: readonly string[]): string | undefined {
  let best: string | undefined;

  for (const value of values) {
    if (value.length + 1 >= rest.length) continue;
    if (!rest.endsWith(value)) continue;
    if (!BOUNDARY.has(rest[rest.length - value.length - 1]!)) continue;
    if (best === undefined || value.length > best.length) best = value;
  }

  return best;
}

/** Drop the separator a value was joined on, however many characters it is. */
function trimTail(rest: string): string {
  let end = rest.length;
  while (end > 0 && BOUNDARY.has(rest[end - 1]!)) end--;
  return rest.slice(0, end);
}
