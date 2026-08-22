import { fail, object, quote, strings, type ParseOptions } from './config-values.js';

/**
 * The `names` section: how a subject id is broken into the axes it is made of.
 *
 * A suite that names its subjects well has already written down what varies.
 * `checkout--dark`, `checkout--dark-ff-on` and `checkout--empty` are not three
 * opaque strings; they are one component at three coordinates, and the only
 * thing between the run and that reading is that nobody said what the words
 * mean. This section says it: an ordered list of axes, each with the values it
 * may take.
 *
 * ## A grammar, and not a function
 *
 * A function is the obvious shape and it is unavailable here on purpose — the
 * config is JSON, because a `.js` config means executing code found on disk in
 * order to decide what to observe (see `config.ts`). What is left is the part of
 * a decomposer worth writing down anyway, and it buys two things the function
 * does not:
 *
 * - **It is reviewable.** A reader can see which words are axes, which axis is
 *   last, and therefore which pairs this run will compare, without running
 *   anything.
 * - **It answers backwards.** A function mapping a name to axes cannot be asked
 *   which *other* name sits one step away along an axis. A vocabulary can, and
 *   that is what makes `checkout--glass` findable from `checkout--green`.
 *
 * ## The order is the whole thing
 *
 * Axes are listed in the order they appear in a name, after the stem — the great
 * green dragon rule in `commands/variations.ts`. English fixes adjective order
 * so that one dragon has one name; a fixed axis order does the same for a suite,
 * and it is what makes a name a coordinate rather than words joined with dashes.
 *
 * ## The first value is the base
 *
 * `values[0]` is what the axis is when nobody says otherwise, and a name
 * carrying it means what a name omitting it means. That is not a convenience: it
 * is what lets `checkout--default` be the subject `checkout--dark` is measured
 * against, so a suite that spells its baseline out loud reads the same as one
 * that leaves it implied.
 */

export interface AxisConfig {
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

export interface NamesConfig {
  readonly axes: readonly AxisConfig[];
}

const AXIS_KEYS = ['axis', 'values'];

/**
 * Parse and check the name grammar.
 *
 * Every refusal below is a reading that would otherwise be quietly wrong. A
 * value shared by two axes makes a name mean two coordinates, and nothing here
 * can know which was meant; a single-value axis is a word every subject carries,
 * which no two subjects can differ on; an empty list is a section that
 * configures nothing while looking configured.
 */
export function parseNames(value: unknown, options: ParseOptions): NamesConfig {
  const root = object(value, 'names', ['axes'], options);
  const axes = root['axes'];

  if (!Array.isArray(axes) || axes.length === 0) {
    fail(
      'names.axes',
      'must be a non-empty array of axes, listed in the order they appear in a subject id',
      options,
    );
  }

  const seenAxis = new Set<string>();
  const owners = new Map<string, string>();

  const parsed = (axes as readonly unknown[]).map((entry, index) => {
    const field = `names.axes[${index}]`;
    const source = object(entry, field, AXIS_KEYS, options);
    const axis = source['axis'];

    if (typeof axis !== 'string' || axis.trim() === '') {
      fail(`${field}.axis`, `must be a non-empty name, not ${quote(axis)}`, options);
    }
    if (seenAxis.has(axis)) {
      fail('names.axes', `names the axis ${quote(axis)} twice`, options);
    }
    seenAxis.add(axis);

    const values = strings(source['values'], `${field}.values`, options);

    if (values.length < 2) {
      fail(
        `${field}.values`,
        'must list at least two values, base first; an axis with one value is a word every ' +
          'subject carries, and no two subjects can differ on it',
        options,
      );
    }

    for (const word of values) {
      const owner = owners.get(word);
      if (owner !== undefined) {
        // Refused rather than resolved by order, for the reason an ambiguous
        // `variance-parent:` tag is refused: a name reading as two coordinates
        // would attach a difference to whichever axis the loop reached first,
        // and print it with full confidence.
        fail(
          'names.axes',
          `gives ${quote(word)} to both ${quote(owner)} and ${quote(axis)}; a value belongs to ` +
            'one axis, or a name says two things at once',
          options,
        );
      }
      owners.set(word, axis);
    }

    return { axis, values };
  });

  return { axes: parsed };
}
