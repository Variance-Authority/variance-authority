/**
 * A route with its loops drawn once.
 *
 * A case that walks a list of a thousand passes through the loop body a
 * thousand times, and the tape keeps every pass, because the tape's job is to
 * lose nothing. A route is for seeing where the code went, not for replaying
 * it: a loop is drawn once and marked as a loop, and how many times it went
 * round stays on the tape.
 *
 * ## What folds
 *
 * A tandem repeat: the same run of steps, back to back, two or more times,
 * with a body of at most {@link PERIOD} steps. The fold takes every repeat one
 * step long across the whole route, then two, and so on, and starts again from
 * one whenever anything folded. Shortest first is what folds a loop inside a
 * loop from the inside out: once the inner loop is one step, two passes of the
 * outer loop are the same steps however many times the inner one went round —
 * once included, because a loop of one step is drawn as that step.
 *
 * The answer is one reading, not the shortest: a repeat that starts mid-pass
 * reads as a pass and a remainder.
 */

/** The longest body a repeat can have, in steps. */
export const PERIOD = 64;

/** One step of a route: a token as the caller gave it, or steps that ran again and again. */
export type Step<T> = { readonly token: T } | { readonly repeat: readonly Step<T>[] };

/**
 * Fold `tokens` into steps.
 *
 * @param keyOf What makes two tokens the same step. Two tokens with one key are
 * folded together, and the first stands for both.
 */
export function foldSteps<T>(tokens: readonly T[], keyOf: (token: T) => string): Step<T>[] {
  const shapes = new Map<string, number>();
  const shapeOf = new WeakMap<object, number>();
  const shape = (step: Step<T>): number => {
    const known = shapeOf.get(step);
    if (known !== undefined) return known;
    let id: number;
    if ('repeat' in step && step.repeat.length === 1) id = shape(step.repeat[0]!);
    else {
      const key = 'token' in step ? `t${keyOf(step.token)}` : `r${step.repeat.map(shape).join(',')}`;
      id = shapes.get(key) ?? shapes.size;
      shapes.set(key, id);
    }
    shapeOf.set(step, id);
    return id;
  };

  let steps: Step<T>[] = tokens.map((token) => ({ token }));
  for (let period = 1; period <= PERIOD; period += 1) {
    const folded = foldAt(steps, steps.map(shape), period);
    if (folded.length === steps.length) continue;
    steps = folded;
    period = 0;
  }
  return steps;
}

/** Every repeat of exactly `period` steps, left to right, each drawn as its first pass. */
function foldAt<T>(steps: readonly Step<T>[], shapes: readonly number[], period: number): Step<T>[] {
  const out: Step<T>[] = [];
  let at = 0;
  while (at < steps.length) {
    let times = 1;
    while (at + (times + 1) * period <= steps.length && same(shapes, at, at + times * period, period)) times += 1;
    if (times < 2) {
      out.push(steps[at]!);
      at += 1;
      continue;
    }
    const body = steps.slice(at, at + period);
    out.push(body.length === 1 && 'repeat' in body[0]! ? body[0]! : { repeat: body });
    at += times * period;
  }
  return out;
}

function same(shapes: readonly number[], left: number, right: number, length: number): boolean {
  for (let offset = 0; offset < length; offset += 1) if (shapes[left + offset] !== shapes[right + offset]) return false;
  return true;
}
