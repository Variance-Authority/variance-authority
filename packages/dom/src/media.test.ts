import { describe, expect, it } from 'vitest';
import { deviceProbe, evaluateMedia, type ConditionEnvironment } from './media.js';

const desktop: ConditionEnvironment = { width: 390, height: 844, deviceScaleFactor: 1, colorScheme: 'light' };

/** A `matchMedia` that answers the way an engine emulating a touch screen does. */
function touchScreen(query: string): { matches: boolean } {
  const answers: Record<string, boolean> = {
    all: true,
    'not all': false,
    '(pointer: coarse)': true,
    '(pointer: fine)': false,
    '(hover: none)': true,
    '(hover: hover)': false,
    '(hover)': false,
  };
  return { matches: answers[query] ?? false };
}

function viewWith(matchMedia: ((query: string) => { matches: boolean }) | undefined): Window {
  return { matchMedia } as unknown as Window;
}

describe('the pointing device a page is observed with', () => {
  it('is asked of the engine, so a touch page and a desktop page resolve apart', () => {
    const device = deviceProbe(viewWith(touchScreen))!;
    const touch = { ...desktop, device };

    expect(evaluateMedia('(pointer: coarse)', touch)).toEqual({ matches: true, uncertain: false });
    expect(evaluateMedia('(pointer: fine)', touch)).toEqual({ matches: false, uncertain: false });
    expect(evaluateMedia('(hover)', touch)).toEqual({ matches: false, uncertain: false });
    expect(evaluateMedia('screen and (hover: none)', touch)).toEqual({ matches: true, uncertain: false });
  });

  it('includes both rules and says so when no engine answers', () => {
    expect(evaluateMedia('(pointer: coarse)', desktop)).toEqual({ matches: true, uncertain: true });
    expect(evaluateMedia('(pointer: fine)', desktop)).toEqual({ matches: true, uncertain: true });
  });

  it('refuses a stand-in that answers one constant, which is what a JSDOM stub does', () => {
    expect(deviceProbe(viewWith(() => ({ matches: false })))).toBeNull();
    expect(deviceProbe(viewWith(() => ({ matches: true })))).toBeNull();
    expect(deviceProbe(viewWith(undefined))).toBeNull();
    expect(deviceProbe(null)).toBeNull();
  });

  it('leaves a declared feature to the declaration, and every other feature to the old rule', () => {
    const device = deviceProbe(viewWith(touchScreen))!;
    const declared = { ...desktop, device, features: { pointer: 'fine' } };

    expect(evaluateMedia('(pointer: coarse)', declared)).toEqual({ matches: false, uncertain: false });
    expect(evaluateMedia('(prefers-reduced-motion: reduce)', declared)).toEqual({
      matches: true,
      uncertain: true,
    });
  });
});
