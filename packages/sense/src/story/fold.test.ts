import { describe, expect, it } from 'vitest';
import { foldSteps, PERIOD, type Step } from './fold.js';

/** A route in one line: `a (b c)` is `a`, then `b c` again and again. */
function drawn(steps: readonly Step<string>[]): string {
  return steps.map((step) => ('token' in step ? step.token : `(${drawn(step.repeat)})`)).join(' ');
}

const fold = (route: string): string => drawn(foldSteps(route.split(' '), (token) => token));

describe('a folded route', () => {
  it('draws a loop once', () => {
    expect(fold('a b c b c b c d')).toBe('a (b c) d');
  });

  it('draws a loop inside a loop once, whatever count the inner one went round', () => {
    expect(fold('a b c c c b c b c c d')).toBe('a (b (c)) d');
  });

  it('keeps passes apart when they went through different places', () => {
    expect(fold('a b c a b d')).toBe('a b c a b d');
  });

  it('draws a single pass as itself', () => {
    expect(fold('a b c')).toBe('a b c');
  });

  it('folds the inner loop first, so the outer one folds around it', () => {
    expect(fold('a a b a a a b')).toBe('((a) b)');
  });

  it(`leaves a body longer than ${PERIOD} steps unfolded`, () => {
    const body = Array.from({ length: PERIOD + 1 }, (_, at) => `s${at}`).join(' ');
    expect(fold(`${body} ${body}`)).toBe(`${body} ${body}`);
  });

  it('folds tokens by the key the caller gives, and the first stands for the rest', () => {
    const steps = foldSteps([{ at: 'a', line: 1 }, { at: 'a', line: 2 }], (token) => token.at);
    expect(steps).toEqual([{ repeat: [{ token: { at: 'a', line: 1 } }], times: 2 }]);
  });

  it('counts how many times each loop went round in all, and adds the passes of each step together', () => {
    const tokens = 'a a b a a a b'.split(' ').map((at) => ({ at, times: 1 }));
    const steps = foldSteps(tokens, (token) => token.at, (kept, folded) => ({ at: kept.at, times: kept.times + folded.times }));
    expect(steps).toEqual([
      { repeat: [{ repeat: [{ token: { at: 'a', times: 5 } }], times: 5 }, { token: { at: 'b', times: 2 } }], times: 2 },
    ]);
  });
});
