import { describe, expect, it } from 'vitest';
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
