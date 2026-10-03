/**
 * The `names` grammar (ADR-0046): what the words in a repository's names mean.
 *
 * `story:checkout--dark-ff-on` is not a string. It is a checkout, dark, with the
 * flag on — a stem and two axes, written in the order the suite always writes
 * them. The grammar is an ordered list of axes, each with the values it may
 * take, and everything that reads a name or a case through it reads it here:
 * `variance run` pairs a subject with its parent, and `variance covering` reads
 * what a case said on the same axes and finds its twin by the same step.
 *
 * ## A grammar, and not a function
 *
 * A function is the obvious shape and it is unavailable on purpose — the config
 * is JSON, because a `.js` config means executing code found on disk in order to
 * decide what to observe. What is left is the part of a decomposer worth writing
 * down anyway, and it buys two things the function does not:
 *
 * - **It is reviewable.** A reader can see which words are axes, which axis is
 *   last, and therefore which pairs a run will compare, without running
 *   anything.
 * - **It answers backwards.** A function mapping a name to axes cannot be asked
 *   which *other* name sits one step away along an axis. A vocabulary can, and
 *   that is what makes `checkout--glass` findable from `checkout--green`.
 *
 * ## The order is the whole thing
 *
 * Axes are listed in the order they appear in a name, after the stem — the great
 * green dragon rule. English fixes adjective order so that one dragon has one
 * name; a fixed axis order does the same for a suite, and it is what makes a
 * name a coordinate rather than words joined with dashes.
 *
 * ## The first value is the base
 *
 * `values[0]` is what the axis is when nobody says otherwise, and a name
 * carrying it means what a name omitting it means. That is what lets
 * `checkout--default` be the subject `checkout--dark` is measured against, so a
 * suite that spells its baseline out loud reads the same as one that leaves it
 * implied.
 */

// compass: variance-authority.adjudication.variations

/** One axis of the grammar: what it is called, and the values it may take. */
export interface GrammarAxis {
  /** What this axis is called, in the sentence a variation prints. */
  readonly axis: string;

  /**
   * The values it may take, base first.
   *
   * A closed vocabulary rather than a pattern, so a value containing the
   * separator — `ff-on`, in a dash-separated name — is one value rather than two
   * axes. It is also what lets a name be walked *toward* its base: the list says
   * what the neighbouring coordinates are called.
   */
  readonly values: readonly string[];
}

/** The `names` section of the root config, checked by {@link parseNameGrammar}. */
export interface NameGrammar {
  readonly axes: readonly GrammarAxis[];
}

/**
 * A grammar refused, naming the field. The CLI's config parser carries it into
 * its own error shape, as it does a `suites` refusal, rather than checking the
 * section twice.
 */
export class NameGrammarError extends Error {
  constructor(
    readonly where: string,
    readonly field: string,
    readonly said: string,
  ) {
    super(`${where}: "${field}" ${said}`);
    this.name = 'NameGrammarError';
  }
}

const GRAMMAR_KEYS = ['axes'];
const AXIS_KEYS = ['axis', 'values'];

/**
 * Check a `names` value and return the grammar it declares.
 *
 * Pure, so every reader of the root config parses the same value with the same
 * rules; `where` is the file it came from and prefixes every refusal. Each
 * refusal is a reading that would otherwise be quietly wrong. A value shared by
 * two axes makes a name mean two coordinates, and nothing here can know which
 * was meant; a single-value axis is a word every subject carries, which no two
 * subjects can differ on; an empty list is a section that configures nothing
 * while looking configured.
 */
export function parseNameGrammar(value: unknown, where: string): NameGrammar {
  const root = record(value, 'names', GRAMMAR_KEYS, where);
  const axes = root['axes'];
  if (!Array.isArray(axes) || axes.length === 0) {
    throw new NameGrammarError(where, 'names.axes',
      'must be a non-empty array of axes, listed in the order they appear in a subject id');
  }

  const seen = new Set<string>();
  const owners = new Map<string, string>();
  return {
    axes: (axes as readonly unknown[]).map((entry, index) => {
      const field = `names.axes[${index}]`;
      const source = record(entry, field, AXIS_KEYS, where);
      const axis = source['axis'];
      if (typeof axis !== 'string' || axis.trim() === '') {
        throw new NameGrammarError(where, `${field}.axis`, `must be a non-empty name, not ${quote(axis)}`);
      }
      if (seen.has(axis)) throw new NameGrammarError(where, 'names.axes', `names the axis ${quote(axis)} twice`);
      seen.add(axis);

      const values = words(source['values'], `${field}.values`, where);
      if (values.length < 2) {
        throw new NameGrammarError(where, `${field}.values`,
          'must list at least two values, base first; an axis with one value is a word every ' +
            'subject carries, and no two subjects can differ on it');
      }
      for (const word of values) {
        const owner = owners.get(word);
        // Refused rather than resolved by order, for the reason an ambiguous
        // `variance-parent:` tag is refused: a name reading as two coordinates
        // would attach a difference to whichever axis the loop reached first,
        // and print it with full confidence.
        if (owner !== undefined) {
          throw new NameGrammarError(where, 'names.axes',
            `gives ${quote(word)} to both ${quote(owner)} and ${quote(axis)}; a value belongs to ` +
              'one axis, or a name says two things at once');
        }
        owners.set(word, axis);
      }
      return { axis, values };
    }),
  };
}

/**
 * An object holding only `known` keys. The field named is the *unknown* one,
 * because that is the character the operator has to delete.
 */
function record(value: unknown, field: string, known: readonly string[], where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NameGrammarError(where, field, `must be an object, not ${quote(value)}`);
  }
  const fields = value as Record<string, unknown>;
  const unknown = Object.keys(fields).find((key) => !known.includes(key));
  if (unknown !== undefined) {
    throw new NameGrammarError(where, `${field}.${unknown}`, `is not a setting this tool has; it accepts ${known.join(', ')}`);
  }
  return fields;
}

function words(value: unknown, field: string, where: string): readonly string[] {
  if (!Array.isArray(value)) throw new NameGrammarError(where, field, `must be an array of strings, not ${quote(value)}`);
  return (value as readonly unknown[]).map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new NameGrammarError(where, `${field}[${index}]`, `must be a non-empty string, not ${quote(entry)}`);
    }
    return entry;
  });
}

function quote(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  return JSON.stringify(value) ?? String(value);
}

/**
 * The characters a name may be extended at.
 *
 * A value has to begin where the rest of the name ends, or `on` would be found
 * inside `london`. What makes a word an *axis* in a name is that it is a piece
 * of it, and a piece has a separator in front.
 */
export const NAME_BOUNDARY: ReadonlySet<string> = new Set(['-', '_', '.', ':', '/', '+', ' ', '~']);

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
   * linked through the grammar when their stems are identical, because a
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
export interface AxisStep {
  readonly axis: string;
  readonly from: string;
  readonly to: string;
}

/** Every subject in a run, at its coordinate. */
export interface NameIndex {
  readonly grammar: NameGrammar;
  /** By subject id. */
  readonly names: ReadonlyMap<string, StructuralName>;
  /** By coordinate: the subjects that sit at it, in plan order. */
  readonly at: ReadonlyMap<string, readonly string[]>;
}

/** What a walk toward the base found, or why it refused to answer. */
export type StructuralLink =
  | { readonly ok: true; readonly parent: string; readonly step: AxisStep }
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
export function readName(id: string, grammar: NameGrammar): StructuralName {
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
    coordinate: axes.filter((entry) => entry.value !== axisOf(grammar, entry.axis)?.values[0]),
  };
}

/**
 * Put every subject in a run at its coordinate.
 *
 * Built once per run rather than per subject: three hundred names asked three
 * hundred questions about their neighbours is the same three hundred readings
 * either way, and the map is what makes each question a lookup.
 */
export function nameIndex(ids: Iterable<string>, grammar: NameGrammar): NameIndex {
  const names = new Map<string, StructuralName>();
  const at = new Map<string, string[]>();

  for (const id of ids) {
    const name = readName(id, grammar);
    names.set(id, name);
    const key = coordinateKey(name.stem, name.coordinate);
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
  if (name === undefined) return undefined;
  const walked = stepTowardBase(name.coordinate, index.grammar, (coordinate) =>
    (index.at.get(coordinateKey(name.stem, coordinate)) ?? []).filter((other) => other !== id));
  if (walked === undefined || walked.found.length === 0) return undefined;
  if (walked.found.length === 1) {
    return { ok: true, parent: walked.found[0]!, step: { axis: walked.axis, from: walked.to, to: walked.from } };
  }
  return {
    ok: false,
    because:
      `its name puts it one step from \`${walked.axis}\` at \`${walked.to}\`, and ` +
      `${walked.found.length} subjects in this run are named that: ` +
      walked.found.map((other) => `\`${other}\``).join(', '),
  };
}

/**
 * The walk toward the base on a coordinate's last axis, over whatever is
 * placed at each coordinate: a subject by its name, or a case by what it said.
 *
 * From the value below the one held back to the base, the first coordinate
 * `at` names anybody at wins. The base is never in a coordinate — a name at
 * its base is a name without the axis — so the last step, `values[0]`, is the
 * axis dropped. Everyone at that coordinate is returned, and what several mean
 * is the caller's: a subject's parent must be one, a twin is read and may be
 * many. A walk that finds nobody ends at the base with `found` empty.
 *
 * Nothing when the coordinate carries no axis: a stem is not a variation of
 * anything.
 */
export function stepTowardBase<Placed>(
  coordinate: readonly NamedAxis[],
  grammar: NameGrammar,
  at: (coordinate: readonly NamedAxis[]) => readonly Placed[],
): (AxisStep & { readonly found: readonly Placed[] }) | undefined {
  const last = coordinate.at(-1);
  if (last === undefined) return undefined;
  // Every coordinate is read off this grammar's own axes — a name by
  // `readName`, a case by what it said on a declared axis — so its axis is here.
  const axis = axisOf(grammar, last.axis)!;
  const held = coordinate.slice(0, -1);
  for (let below = axis.values.indexOf(last.value) - 1; below >= 0; below--) {
    const value = axis.values[below]!;
    const found = at(below === 0 ? held : [...held, { axis: last.axis, value }]);
    if (found.length > 0) return { axis: last.axis, from: last.value, to: value, found };
  }
  return { axis: last.axis, from: last.value, to: axis.values[0]!, found: [] };
}

/** The axis the grammar declares under this name, when it declares one. */
export function axisOf(grammar: NameGrammar | undefined, name: string): GrammarAxis | undefined {
  return grammar?.axes.find((entry) => entry.axis === name);
}

/** The key of a stem at a coordinate, which {@link NameIndex.at} is keyed by. */
export function coordinateKey(stem: string, coordinate: readonly NamedAxis[]): string {
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
    if (!NAME_BOUNDARY.has(rest[rest.length - value.length - 1]!)) continue;
    if (best === undefined || value.length > best.length) best = value;
  }

  return best;
}

/** Drop the separator a value was joined on, however many characters it is. */
function trimTail(rest: string): string {
  let end = rest.length;
  while (end > 0 && NAME_BOUNDARY.has(rest[end - 1]!)) end--;
  return rest.slice(0, end);
}
