import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LAYOUT_RECIPE,
  RASTER_RECIPE,
  SEMANTIC_RECIPE,
  conflicts,
  describeRecipe,
  forTier,
  hideCaret,
  holdAnimations,
  pinAnimations,
  recipeCss,
  recipeDigest,
  recipeScreenshot,
  settleRecipe,
  waitForFonts,
  waitForImages,
  type Intervention,
} from './stabilize.js';

/**
 * Interventions as composable tricks.
 *
 * What is asserted is not that each one works — a CSS string cannot be checked
 * without a browser — but the four properties that make an open set safer than a
 * closed one: a tier is charged only for what it can observe, two tricks over one
 * property are reported rather than silently resolved, the applied set is part of
 * the identity of what it produced, and a project's own trick composes with these
 * without editing them.
 */

describe('paying only for what a tier can observe', () => {
  it('asks for nothing at the structure-and-style rung', () => {
    // A font that has not loaded cannot change which rules match or what they
    // declare. Waiting for it before a hash buys nothing and costs the wait per
    // subject, on the rung that exists to be cheap.
    expect(forTier(RASTER_RECIPE, 'semantic')).toEqual([]);
    expect(recipeCss(SEMANTIC_RECIPE)).toBe('');
  });

  it('drops the caret for a tier that never rasterizes', () => {
    // A caret paints and does not lay out, so hiding it for a layout-only tier
    // changes the subject and buys nothing.
    const layout = forTier(RASTER_RECIPE, 'layout');

    expect(layout).not.toContain(hideCaret);
    expect(forTier(RASTER_RECIPE, 'raster')).toContain(hideCaret);
  });

  it('keeps asset waits once layout is resolved', () => {
    expect(forTier(RASTER_RECIPE, 'layout')).toContain(waitForFonts);
  });
});

describe('two tricks over one property', () => {
  it('reports the clash instead of quietly letting one win', () => {
    // Pinning animations in CSS while asking the compositor to fast-forward them
    // applies both, and the CSS wins by accident of ordering. Which one won is
    // invisible in the resulting image.
    const clashing = [...LAYOUT_RECIPE, pinAnimations];

    expect(conflicts(clashing)).toEqual([
      { governs: 'animations', ids: ['hold-animations', 'pin-animations'] },
    ]);
  });

  it('finds nothing to report in the shipped recipes', () => {
    expect(conflicts(RASTER_RECIPE)).toEqual([]);
    expect(conflicts(LAYOUT_RECIPE)).toEqual([]);
  });

  it('keeps the two animation tricks separate rather than one flag', () => {
    // They express one intent and produce different images: the browser settles
    // a finite animation where a user sees it, and CSS pins the frame where a
    // fade-in is invisible. Collapsing them into a boolean would hide the choice.
    expect(holdAnimations.screenshot).toEqual({ animations: 'disabled' });
    expect(pinAnimations.css).toContain('animation-play-state:paused');
    expect(pinAnimations.css).not.toContain('animation:none');
  });
});

describe('what was done is part of what was measured', () => {
  it('gives two recipes two identities', () => {
    expect(recipeDigest(LAYOUT_RECIPE)).not.toBe(recipeDigest(RASTER_RECIPE));
  });

  it('ignores the order tricks were composed in', () => {
    expect(recipeDigest([...RASTER_RECIPE].reverse())).toBe(recipeDigest(RASTER_RECIPE));
  });

  it('separates the same intent applied two ways', () => {
    // A baseline whose fade-in was fast-forwarded must never be compared against
    // one whose fade-in was pinned at zero.
    expect(recipeDigest([holdAnimations])).not.toBe(recipeDigest([pinAnimations]));
  });
});

describe('composing a trick this package does not ship', () => {
  it('accepts one and folds it into every derived answer', () => {
    // The reason this is an open set. A project with a need nobody anticipated
    // adds a value; it does not fork a type.
    const freezeVideo: Intervention = {
      id: 'freeze-video',
      trick: 'hold',
      needs: 'raster',
      governs: 'video',
      because: 'video elements paused at their poster frame',
      css: 'video{display:none !important}',
    };

    const recipe = [...RASTER_RECIPE, freezeVideo];

    expect(recipeCss(recipe)).toContain('video{display:none');
    expect(recipeDigest(recipe)).not.toBe(recipeDigest(RASTER_RECIPE));
    expect(describeRecipe(recipe)).toContain('poster frame');
    expect(conflicts(recipe)).toEqual([]);
  });
});

describe('applying a recipe', () => {
  it('merges every screenshot contribution', () => {
    expect(recipeScreenshot(RASTER_RECIPE)).toEqual({ animations: 'disabled', caret: 'hide' });
  });

  it('runs every wait, in order', async () => {
    const ran: string[] = [];
    const trick = (id: string): Intervention => ({
      id,
      trick: 'wait',
      needs: 'layout',
      governs: id,
      because: id,
      settle: async () => {
        ran.push(id);
      },
    });

    await settleRecipe([trick('a'), trick('b')], { evaluate: async () => undefined });
    expect(ran).toEqual(['a', 'b']);
  });

  it('names every intervention, so nobody reads the image as the product', () => {
    const text = describeRecipe(RASTER_RECIPE);

    expect(text).toContain('fast-forwarded');
    expect(text).toContain('caret hidden');
    expect(describeRecipe(SEMANTIC_RECIPE)).toContain('untouched');
  });
});

/**
 * An image that never answers, which is not the same as an image that fails.
 *
 * A stalled response fires neither `load` nor `error`, so the wait it belongs to
 * has no event to end on. These run the settle closure directly against a
 * stand-in document — it is written to be shipped into a page, and a page is the
 * one thing this package is not allowed to have — which is enough to pin the two
 * behaviours that matter: it ends when the images arrive, and it *refuses* rather
 * than returning when they do not.
 */
describe('waiting for images', () => {
  interface FakeImage {
    complete: boolean;
    readonly currentSrc: string;
    readonly src: string;
    loading: string;
    addEventListener(type: string, listener: () => void): void;
    arrive(afterMs: number): void;
  }

  /**
   * Answers after `afterMs`, or never when that is `undefined`.
   *
   * `deferred` moves the same arrival behind the `loading` attribute, which is
   * the browser's: an image the page marked lazy is not requested at all until
   * something stops deferring it, and until then it fires neither event.
   */
  const image = (src: string, afterMs?: number): FakeImage => {
    const listeners: Record<string, () => void> = {};
    const self: FakeImage = {
      complete: false,
      currentSrc: src,
      src,
      loading: 'eager',
      addEventListener: (type, listener) => {
        listeners[type] = listener;
      },
    };

    const arrive = (ms: number): void => {
      setTimeout(() => {
        self.complete = true;
        listeners['load']?.();
      }, ms);
    };

    if (afterMs !== undefined) arrive(afterMs);

    return Object.assign(self, { arrive });
  };

  const deferred = (src: string, afterMs: number): FakeImage => {
    const self = image(src);
    let asked = 'lazy';

    Object.defineProperty(self, 'loading', {
      get: () => asked,
      set: (value: string) => {
        asked = value;
        if (value === 'eager') self.arrive(afterMs);
      },
    });

    return self;
  };

  const settleWith = async (images: readonly FakeImage[]): Promise<void> => {
    const page = { document: { images }, setTimeout };
    const previous = Reflect.get(globalThis, 'document');
    Reflect.set(globalThis, 'document', page.document);

    try {
      await waitForImages.settle?.({ evaluate: async (fn) => fn() });
    } finally {
      Reflect.set(globalThis, 'document', previous);
    }
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns as soon as the last one arrives', async () => {
    const settled = settleWith([image('a.png', 10), image('b.png', 900)]);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(settled).resolves.toBeUndefined();
  });

  it('refuses the subject rather than hanging on a response that never comes', async () => {
    // Named, because the useful half of this failure is *which* ones. A run that
    // said only "timed out" would leave the operator to find two requests out of
    // twenty-one by hand.
    //
    // The expectation is attached before the clock moves: a rejection that lands
    // while nothing is listening is an unhandled rejection, which this suite
    // would report as an error of its own on a run that behaved correctly.
    const refused = expect(
      settleWith([image('arrives.png', 10), image('stalls.png')]),
    ).rejects.toThrow(/1 image\(s\) had not loaded.*stalls\.png/s);

    await vi.advanceTimersByTimeAsync(15_000);
    await refused;
  });

  it('asks for the ones the browser deferred, which are otherwise never coming', async () => {
    // Without this the trick waits fifteen seconds and then refuses a page whose
    // only fault is being taller than the viewport — and a full-page capture is
    // exactly where most of the images are below it. The fake answers only once
    // something stops deferring it, so arriving is the evidence it was asked.
    const below = deferred('below-the-fold.png', 20);
    const settled = settleWith([below]);

    await vi.advanceTimersByTimeAsync(50);
    await expect(settled).resolves.toBeUndefined();
    expect(below.complete).toBe(true);
  });

  it('hands back a page whose markup says what it said before', async () => {
    // The asking is an edit to a reflected attribute, and the tier that reads
    // the document runs after this one. Which images were still undecoded here
    // is a question about the network, so a flip left in place lands in some
    // readings and not others — the same page at two widths disagreeing about
    // its own markup, reported as a change in the shop.
    const below = deferred('below-the-fold.png', 20);
    const settled = settleWith([below]);

    await vi.advanceTimersByTimeAsync(50);
    await settled;
    expect(below.loading).toBe('lazy');
  });

  it('hands it back on the way out of a refusal too', async () => {
    const stuck = deferred('never.png', 60_000);
    const refused = expect(settleWith([stuck])).rejects.toThrow(/never\.png/);

    await vi.advanceTimersByTimeAsync(15_000);
    await refused;
    expect(stuck.loading).toBe('lazy');
  });

  it('does not wait at all for a page whose images are already decoded', async () => {
    const decoded = { ...image('done.png'), complete: true };
    await expect(settleWith([decoded])).resolves.toBeUndefined();
  });
});
