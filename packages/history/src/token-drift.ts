import { instant } from './instant.js';
import type { Journey } from './store.js';

/**
 * A token's recorded values, reduced to a journey.
 *
 * Separate from churn because it answers the other half of the question and
 * shares none of its arithmetic: churn counts runs and divides by runs, this
 * subtracts values and sums the differences. The finding it exists to produce —
 * many small approved steps whose total no single review ever saw — depends on
 * arithmetic over the values themselves, which is why the quantity parsing and
 * its refusals live next to it rather than in a shared numeric helper. A value
 * this file cannot subtract is a reportable finding, not an error, and only code
 * that knows what a token value is can say which.
 */

/**
 * One value change, with the commit that made it.
 *
 * The commit is what turns a journey into something actionable: `12px → 20px` is
 * a finding, and `12px → 20px, here are the eight commits` is an investigation
 * somebody can finish.
 */
export interface DriftStep {
  readonly from: string;
  readonly to: string;
  readonly commit: string;
  readonly at: string;
}

/** The journey as arithmetic, present only when every value is the same kind of quantity. */
export interface Quantity {
  /** `px`, `rem`, `%`, or empty for a unitless value such as a line-height. */
  readonly unit: string;
  readonly from: number;
  readonly to: number;
  /** `to - from`. Zero when the value came back to where it started. */
  readonly net: number;
  /** The largest single step, which is the most any one review could have seen. */
  readonly largestStep: number;
  /** Sum of the absolute steps. Larger than `|net|` whenever the value changed direction. */
  readonly travel: number;
}

export interface TokenDrift {
  readonly token: string;
  readonly from: string;
  readonly to: string;
  readonly steps: readonly DriftStep[];
  /** Recorded values behind those steps. Higher when consecutive runs resolved the same value. */
  readonly readings: number;
  readonly firstAt: string;
  readonly lastAt: string;

  readonly quantity?: Quantity;
  /** Why no arithmetic was possible, when `quantity` is absent. Never left silent. */
  readonly unquantifiable?: string;

  /** `travel / largestStep` — how many reviews the movement was spread across. */
  readonly ratio?: number;

  /**
   * Whether this journey is worth putting in front of somebody.
   *
   * The case the whole store exists for: many small approved steps summing to far
   * more than any single one, so that every individual change was correctly
   * approved and the total was never reviewed by anyone. A single large step is
   * *not* notable here — it was reviewable as one change, and whoever approved it
   * saw its full size.
   */
  readonly notable: boolean;

  /** `true` when the window's limit excluded steps, making every total a lower bound. */
  readonly incomplete: boolean;
  readonly omitted: number;
}

export interface DriftOptions {
  /** Fewest value changes that can constitute a journey. Below this it is one edit. */
  readonly minSteps?: number;
  /** Least ratio of total travel to the largest step before the spread is the finding. */
  readonly minRatio?: number;
}

const DEFAULT_MIN_STEPS = 2;
const DEFAULT_MIN_RATIO = 2;

/**
 * Reduce a token's recorded values to a journey, or to nothing.
 *
 * `null` means the token did not move in this window, and that is an observation
 * rather than an absence: the values were recorded, they were read, and they were
 * the same. The one case where nothing is not an answer is a journey whose limit
 * excluded steps — then a `null` would claim stability the slice cannot support,
 * so an incomplete journey is always returned and always says so.
 */
export function detectDrift(journey: Journey, options: DriftOptions = {}): TokenDrift | null {
  const minSteps = options.minSteps ?? DEFAULT_MIN_STEPS;
  const minRatio = options.minRatio ?? DEFAULT_MIN_RATIO;
  const incomplete = journey.omitted > 0;

  if (journey.values.length === 0) {
    if (!incomplete) return null;
    throw new Error(
      `the journey for \`${journey.token}\` returned no values while reporting ` +
        `${journey.omitted} omitted: nothing can be concluded from a slice that excluded everything`,
    );
  }

  // Sorted rather than trusted: a store that returned rows in insertion order
  // would otherwise produce a journey that runs backwards, and `from → to` read
  // backwards is a confident, exactly wrong sentence.
  const values = [...journey.values].sort((a, b) => instant(a.at) - instant(b.at));
  const first = values[0]!;
  const last = values[values.length - 1]!;

  // Consecutive repeats are folded into one step. A token that resolves to the
  // same value in forty runs did not move forty times; the readings are kept as a
  // count so the folding is visible.
  const steps: DriftStep[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]!;
    const current = values[index]!;
    if (current.value === previous.value) continue;
    steps.push({
      from: previous.value,
      to: current.value,
      commit: current.commit,
      at: current.at,
    });
  }

  if (steps.length === 0 && !incomplete) return null;

  const quantified = quantify(first.value, steps);
  const ratio =
    quantified.quantity !== undefined && quantified.quantity.largestStep > 0
      ? quantified.quantity.travel / quantified.quantity.largestStep
      : undefined;

  // A measurable value has to have actually moved: `12px → 12.0px → 12px` is a
  // change of notation and reporting it as drift would put a finding in front of
  // somebody that no amount of reading the commits explains. A value that cannot
  // be measured at all keeps its count as the finding, since the count is the only
  // thing there is to report.
  const spread =
    quantified.quantity === undefined ? true : ratio !== undefined && ratio >= minRatio;
  const notable = incomplete || (steps.length >= minSteps && spread);

  return {
    token: journey.token,
    from: first.value,
    to: last.value,
    steps,
    readings: values.length,
    firstAt: first.at,
    lastAt: last.at,
    ...quantified,
    ...(ratio !== undefined ? { ratio } : {}),
    notable,
    incomplete,
    omitted: journey.omitted,
  };
}

/**
 * Whether the values form one measurable quantity, and the arithmetic if so.
 *
 * A colour, a font stack, and a shadow are all legitimate token values and none of
 * them can be subtracted. Returning "not measurable, and here is why" keeps a
 * colour that changed five times a reportable finding instead of an empty number.
 */
function quantify(
  firstValue: string,
  steps: readonly DriftStep[],
): { quantity?: Quantity; unquantifiable?: string } {
  const values = [firstValue, ...steps.map((step) => step.to)];
  const parsed = values.map(parseQuantity);

  const unparsed = values.filter((_, index) => parsed[index] === null);
  if (unparsed.length > 0) {
    return {
      unquantifiable: `${unparsed.length} of ${values.length} value(s) are not single quantities (${unparsed[0]!})`,
    };
  }

  const units = new Set(parsed.map((value) => value!.unit));
  if (units.size > 1) {
    return {
      unquantifiable: `the values change unit (${[...units].map((unit) => unit === '' ? '(none)' : unit).join(', ')}), and a unit change cannot be subtracted`,
    };
  }

  const numbers = parsed.map((value) => value!.amount);
  const from = numbers[0]!;
  const to = numbers[numbers.length - 1]!;

  let travel = 0;
  let largestStep = 0;
  for (let index = 1; index < numbers.length; index += 1) {
    const delta = Math.abs(numbers[index]! - numbers[index - 1]!);
    travel += delta;
    if (delta > largestStep) largestStep = delta;
  }

  return {
    quantity: { unit: [...units][0] ?? '', from, to, net: to - from, largestStep, travel },
  };
}

const QUANTITY = /^(-?(?:\d+(?:\.\d+)?|\.\d+))([a-z%]*)$/i;

function parseQuantity(value: string): { amount: number; unit: string } | null {
  const match = QUANTITY.exec(value.trim());
  if (match === null) return null;
  return { amount: Number(match[1]), unit: (match[2] ?? '').toLowerCase() };
}
