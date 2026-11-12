import { describe, expect, it } from 'vitest';
import { locateInstability, summarizeInstability } from './instability.js';
import { normalize } from '../rules/normalize/index.js';
import { CHROMIUM_PROFILE, capture, node } from '../rules/normalize/fixture.js';
import type { RawCapture } from '../format/capture.js';
import type { SourceIndex } from './source.js';

/**
 * Locating an instability, tested on two captures of one commit.
 *
 * The scenario throughout is the one a stabilisation loop exists to paper over:
 * the same subject, observed twice, disagreeing. What is asserted is that the
 * disagreement resolves to a component and a moved declaration — because that is
 * what makes a fix possible at the source, and a fix at the source is what stops
 * the extra captures being needed at all.
 *
 * The case that matters most is the last one: when nothing moved semantically and
 * pixels still did, this must refuse to name a component. Inventing a location
 * there would send someone to a file that has nothing wrong with it.
 */

const snap = (raw: RawCapture) => normalize(raw);

/** A spinner mid-rotation, captured twice at different points in the animation. */
const spinner = (transform: string): RawCapture =>
  capture({
    profile: CHROMIUM_PROFILE,
    root: node({
      tag: 'div',
      owners: [{ name: 'Page' }],
      children: [
        node({
          tag: 'div',
          owners: [{ name: 'Spinner' }, { name: 'Page' }],
          rules: [{ selector: '.spin', declare: { transform, opacity: '1' } }],
          rect: { x: 0, y: 0, width: 24, height: 24 },
        }),
      ],
    }),
  });

const clock = (text: string): RawCapture =>
  capture({
    profile: CHROMIUM_PROFILE,
    root: node({
      tag: 'div',
      owners: [{ name: 'Page' }],
      children: [
        node({
          tag: 'time',
          owners: [{ name: 'Timestamp' }, { name: 'Page' }],
          text,
          rect: { x: 0, y: 0, width: 80, height: 16 },
        }),
      ],
    }),
  });

const SOURCE: SourceIndex = {
  Spinner: [{ file: 'src/ds/components.tsx', line: 88, kind: 'function' }],
};

describe('a subject that moved between two captures', () => {
  it('names the component and the declaration that moved', () => {
    // The whole point. A pixel comparison reports that some pixels differ, which
    // is equally true of an animation, a clock and a font substitution. This
    // reports which component, which property, and both values.
    const result = locateInstability(
      snap(spinner('rotate(12deg)')),
      snap(spinner('rotate(47deg)')),
    );

    expect(result.stable).toBe(false);
    expect(result.locations[0]?.component).toBe('Spinner');
    expect(result.locations[0]?.properties).toContainEqual({
      property: 'transform',
      from: 'rotate(12deg)',
      to: 'rotate(47deg)',
    });
  });

  it('says plainly that this is not something to retry away', () => {
    // A stabilisation loop would resolve this by capturing again and the run
    // would go green having learned nothing, at the cost of the extra captures,
    // every run, forever.
    const result = locateInstability(
      snap(spinner('rotate(12deg)')),
      snap(spinner('rotate(47deg)')),
    );

    expect(result.because).toContain('not noise to retry away');
    expect(result.because).toContain('same commit');
  });

  it('reads an animation from the shape of the evidence', () => {
    expect(
      locateInstability(snap(spinner('rotate(12deg)')), snap(spinner('rotate(47deg)')))
        .locations[0]?.likely,
    ).toBe('animation');
  });

  it('reads changing text as dynamic content rather than as an animation', () => {
    const result = locateInstability(snap(clock('10:04:11')), snap(clock('10:04:12')));

    expect(result.locations[0]?.component).toBe('Timestamp');
    expect(result.locations[0]?.likely).toBe('dynamic-content');
  });

  it('resolves the component to a file an editor opens', () => {
    const text = summarizeInstability(
      locateInstability(snap(spinner('rotate(12deg)')), snap(spinner('rotate(47deg)'))),
      { source: SOURCE },
    );

    expect(text).toContain('Spinner');
    expect(text).toContain('src/ds/components.tsx:88');
    expect(text).toContain('transform rotate(12deg) → rotate(47deg)');
  });
});

describe('a difference this tier cannot see', () => {
  it('refuses to name a component when only the pixels moved', () => {
    // The boundary that keeps the rest honest. Glyph rasterization is not a
    // property of the box tree, so there is no component to blame and no file to
    // open. Naming the nearest one would send somebody to correct code.
    const result = locateInstability(snap(spinner('rotate(12deg)')), snap(spinner('rotate(12deg)')), {
      pixelsDiffer: true,
    });

    expect(result.stable).toBe(false);
    expect(result.band).toBe('sub-semantic');
    expect(result.locations).toEqual([]);
    expect(result.because).toContain('no component is responsible');
    expect(result.because).toContain('environment key');
  });

  it('does not call a subject stable on a comparison nobody made', () => {
    // `pixelsDiffer` omitted means the image question was never asked. Reporting
    // "stable" without qualification would be a verdict resting on a measurement
    // that does not exist.
    const result = locateInstability(snap(spinner('rotate(12deg)')), snap(spinner('rotate(12deg)')));

    expect(result.stable).toBe(true);
    expect(result.because).toContain('unobserved rather than absent');
  });

  it('states the full agreement only when the image comparison agreed too', () => {
    const result = locateInstability(
      snap(spinner('rotate(12deg)')),
      snap(spinner('rotate(12deg)')),
      { pixelsDiffer: false },
    );

    expect(result.stable).toBe(true);
    expect(result.band).toBe('none');
    expect(result.because).toContain('pixels');
  });
});

describe('what it refuses to guess', () => {
  it('offers no reading when the evidence fits more than one', () => {
    // A component whose colour and transform both moved could be an animation or
    // a theme resolving differently. A label that fires on ambiguity sends
    // somebody to the wrong file with confidence, and the facts beside it get
    // read as equally certain.
    const before = capture({
      profile: CHROMIUM_PROFILE,
      root: node({
        tag: 'div',
        owners: [{ name: 'Spinner' }],
        rules: [{ selector: '.s', declare: { transform: 'rotate(0deg)', color: 'rgb(0, 0, 0)' } }],
      }),
    });
    const after = capture({
      profile: CHROMIUM_PROFILE,
      root: node({
        tag: 'div',
        owners: [{ name: 'Spinner' }],
        rules: [{ selector: '.s', declare: { transform: 'rotate(9deg)', color: 'rgb(255, 0, 0)' } }],
      }),
    });

    expect(locateInstability(snap(before), snap(after)).locations[0]?.likely).toBeUndefined();
  });

  it('refuses two captures that are not of the same subject', () => {
    // Two captures of different things are not evidence about stability, and a
    // small diff would read as one.
    const a = snap(capture({ root: node({ tag: 'p' }), subjectId: 'story:a' }));
    const b = snap(capture({ root: node({ tag: 'p' }), subjectId: 'story:b' }));

    expect(() => locateInstability(a, b)).toThrow(/different subjects/);
  });
});
