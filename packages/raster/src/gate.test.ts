import { describe, expect, it } from 'vitest';
import { gateStability, summarizeGate } from './gate.js';

/**
 * The gate, tested for the three answers it must keep apart and the one thing it
 * must never do.
 */

const sample = (documentDigest: string) => ({ documentDigest });

describe('deciding without a camera', () => {
  it('lets a subject through when its documents agree', () => {
    const verdict = gateStability([sample('v1:a'), sample('v1:a')]);
    expect(verdict.state).toBe('stable');
    expect(verdict.render).toBe(true);
  });

  it('refuses to render a subject that was still moving', () => {
    // An image of something in motion is a baseline that never corresponded to
    // a state of the product, and every later run compares against it.
    const verdict = gateStability([sample('v1:a'), sample('v1:b')]);
    expect(verdict.state).toBe('unstable');
    expect(verdict.render).toBe(false);
  });

  it('never asks for a third sample', () => {
    // One disagreement is the answer. A third could only say how often it
    // happens, which is not the question — and re-observing until two agree is
    // the behaviour this gate exists to replace.
    const verdict = gateStability([sample('v1:a'), sample('v1:b'), sample('v1:a')]);
    expect(verdict.state).toBe('unstable');
  });
});

describe('the state that is neither', () => {
  it('reports one sample as unchecked, not as stable', () => {
    // A verdict resting on a comparison nobody made. It is not a failure — a
    // project may decline the second sample — but printing it as a pass is.
    const verdict = gateStability([sample('v1:a')]);

    expect(verdict.state).toBe('unknown');
    expect(verdict.render).toBe(true);
    expect(summarizeGate(verdict)).toContain('absence of the check');
  });

  it('renders nothing when nothing was sampled', () => {
    expect(gateStability([])).toMatchObject({ state: 'unknown', render: false });
  });
});

describe('what it tells the reader', () => {
  it('says the fix is in the component, not in a longer wait', () => {
    const text = summarizeGate(gateStability([sample('v1:a'), sample('v1:b')]));

    expect(text).toContain('no image was taken');
    expect(text).toContain('the fix is in the component');
  });
});
