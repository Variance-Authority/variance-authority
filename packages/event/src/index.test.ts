// The claim under test is that the announcing half is inert until something
// listens, that what it says is exactly the four values it was given, and that a
// listener cannot reach back into the code that announced.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EVENT_SINK, vae, vaEnd, vaStart } from './index.js';

type Heard = [phase: string, location: string, subject: string, action: string];

const scope = globalThis as Record<string, unknown>;

function listen(): Heard[] {
  const heard: Heard[] = [];
  scope[EVENT_SINK] = (...announcement: Heard) => heard.push(announcement);
  return heard;
}

afterEach(() => {
  delete scope[EVENT_SINK];
});

describe('vae', () => {
  it('announces its own sink name', () => {
    // The module names the property twice — once as the exported constant a
    // listener installs on, once in the type it reads through — and a drift
    // between them would be silent everywhere except here.
    const heard = listen();
    vae('checkout', 'upsell-modal', 'decided');
    expect(heard).toEqual([['once', 'checkout', 'upsell-modal', 'decided']]);
  });

  it('says nothing when nobody is listening', () => {
    expect(() => vae('checkout', 'upsell-modal', 'decided')).not.toThrow();
    expect(scope[EVENT_SINK]).toBeUndefined();
  });

  it('ignores a sink that is not callable', () => {
    scope[EVENT_SINK] = 'installed by something else';
    expect(() => vae('checkout', 'upsell-modal', 'decided')).not.toThrow();
  });

  it('reads the sink on every call, so a listener may arrive late', () => {
    vae('checkout', 'upsell-modal', 'decided');
    const heard = listen();
    vae('checkout', 'upsell-modal', 'decided');
    expect(heard).toHaveLength(1);
  });

  it('survives a listener that throws', () => {
    const sink = vi.fn(() => {
      throw new Error('the harness is broken');
    });
    scope[EVENT_SINK] = sink;
    expect(() => vae('checkout', 'upsell-modal', 'decided')).not.toThrow();
    expect(sink).toHaveBeenCalledOnce();
  });
});

describe('vaStart and vaEnd', () => {
  it('bound a process on one set of coordinates', () => {
    const heard = listen();
    vaStart('checkout', 'payment', 'authorizing');
    vaEnd('checkout', 'payment', 'authorizing');
    expect(heard).toEqual([
      ['start', 'checkout', 'payment', 'authorizing'],
      ['end', 'checkout', 'payment', 'authorizing'],
    ]);
  });
});
