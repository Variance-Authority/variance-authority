import { describe, expect, it } from 'vitest';
import { sidecarFrom } from './codec.js';

/**
 * What survives being written beside a baseline and read back a month later.
 *
 * A sidecar is the one record here nobody re-derives. It is committed, it
 * outlives the code that wrote it, and every field added to it arrives in a
 * repository full of files that do not have it — so the reader's job is to keep
 * *this baseline never said* apart from *this baseline said no*, on every field,
 * forever. The boxes are the newest and the easiest to get wrong: read
 * positionally, they are the one field where a partial answer is a wrong one.
 */

const IDENTITY = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

function sidecar(components: readonly unknown[]): unknown {
  return {
    documentDigest: 'v1:d',
    identity: IDENTITY,
    width: 1_280,
    height: 402,
    missingFonts: [],
    components,
  };
}

const BUTTON = {
  component: 'Button',
  instances: 1,
  structure: 'v1:s',
  semantics: 'v1:a',
  text: 'v1:t',
  style: 'v1:y',
  geometry: 'v1:g',
};

describe('the component boxes a sidecar carries', () => {
  it('reads back the box a run measured', () => {
    const read = sidecarFrom(
      sidecar([{ ...BUTTON, boxes: [{ x: 24, y: 318, width: 158, height: 44 }] }]),
    );

    expect(read?.components?.[0]?.boxes).toEqual([{ x: 24, y: 318, width: 158, height: 44 }]);
  });

  it('keeps a boundary the browser laid out nothing for in its place', () => {
    // Positional, so a dropped entry pairs every instance after it against the
    // wrong one. `null` is the entry that says *this instance had no box* and
    // still holds the position that makes the rest of the list mean anything.
    const read = sidecarFrom(
      sidecar([{ ...BUTTON, instances: 2, boxes: [null, { x: 0, y: 0, width: 8, height: 8 }] }]),
    );

    expect(read?.components?.[0]?.boxes).toEqual([null, { x: 0, y: 0, width: 8, height: 8 }]);
  });

  it('drops a list that does not match the instance count', () => {
    // The failure worth guarding. Two instances and one box is not *one box I
    // can use*; paired by index it measures the first instance and silently
    // says nothing about the second, which reads as agreement.
    const read = sidecarFrom(sidecar([{ ...BUTTON, instances: 2, boxes: [{ x: 0, y: 0, width: 8, height: 8 }] }]));

    expect(read?.components?.[0] && 'boxes' in read.components[0]).toBe(false);
  });

  it('drops a malformed box rather than refusing the whole baseline', () => {
    // These decide a sentence, not a verdict. A sidecar refused over them would
    // break a comparison that worked before the field existed — the field added
    // to explain a change taking the change down with it.
    const read = sidecarFrom(sidecar([{ ...BUTTON, boxes: [{ x: 0, y: 0, width: '8', height: 8 }] }]));

    expect(read?.components?.[0]?.component).toBe('Button');
    expect(read?.components?.[0] && 'boxes' in read.components[0]).toBe(false);
  });

  it('leaves a baseline written before boxes existed without them', () => {
    const read = sidecarFrom(sidecar([BUTTON]));

    expect(read?.components).toHaveLength(1);
    expect(read?.components?.[0] && 'boxes' in read.components[0]).toBe(false);
  });

  it('still refuses a sidecar whose digests will not parse', () => {
    // The line the leniency above stops at: a missing `style` digest is not a
    // field a reader can do without, and a component list with a hole in it
    // would compare unequal to itself.
    const { style: _dropped, ...broken } = BUTTON;

    expect(sidecarFrom(sidecar([broken]))?.components).toBeUndefined();
  });
});
