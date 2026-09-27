import { describe, expect, it } from 'vitest';
import type { Viewport } from '@variance-authority/core/format';
import { unresizable, unwidened, widthsOf } from './viewport.js';

/**
 * The refusal that stands between a run and a green wall.
 *
 * A subject asking for a scale or a scheme the open context does not have is the
 * one difference a run cannot detect afterwards: the capture records the value
 * that was *requested*, the environment key hashes it, and every later
 * comparison agrees with a baseline of a render that never happened. So the
 * refusal is the product, and it is asserted here rather than through either
 * collector because both of them have to say it in the same words.
 */

const RUN: Viewport = { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' };

describe('unresizable', () => {
  it('lets a width and a height through, because those are a resize', () => {
    expect(unresizable({ ...RUN, width: 375, height: 2000 }, RUN)).toBeUndefined();
    expect(unresizable(RUN, RUN)).toBeUndefined();
  });

  it('refuses a scale factor the open context cannot be given', () => {
    const refusal = unresizable({ ...RUN, deviceScaleFactor: 2 }, RUN);

    // Both numbers, because a reader deciding what to do needs to know which
    // half to change — the subject or the run.
    expect(refusal).toContain('deviceScaleFactor 2');
    expect(refusal).toContain('at 1');
    // And the way out, since the answer is never "resize it".
    expect(refusal).toContain('its own run');
  });

  it('refuses a colour scheme for the same reason, in the same words', () => {
    const refusal = unresizable({ ...RUN, colorScheme: 'dark' }, RUN);

    expect(refusal).toContain('dark colour scheme');
    expect(refusal).toContain('fixed when the browser context is created');
  });

  it('reports the scale before the scheme when both are wrong', () => {
    // One sentence at a time on purpose: a subject that differs in both is
    // misconfigured in one way, and two refusals read as two problems.
    const refusal = unresizable({ ...RUN, deviceScaleFactor: 3, colorScheme: 'dark' }, RUN);

    expect(refusal).toContain('deviceScaleFactor 3');
    expect(refusal).not.toContain('colour scheme and the run');
  });
});

describe('widthsOf', () => {
  const plan = {
    subjects: [
      { subject: { id: 'route/home' } },
      { subject: { id: 'story:button--primary' }, viewport: { ...RUN, width: 320 } },
    ],
    warnings: ['kept'],
  };

  it('makes each declared width its own subject, narrowest first, and leaves a declared viewport alone', () => {
    const widened = widthsOf(plan, [1280, 375, 1280], RUN);

    expect(widened.subjects.map((planned) => [planned.subject.id, planned.viewport?.width])).toEqual([
      ['route/home@375', 375],
      ['route/home@1280', 1280],
      ['story:button--primary', 320],
    ]);
    expect(widened.subjects[0]?.viewport).toEqual({ ...RUN, width: 375 });
    expect(widened.warnings).toEqual(['kept']);
  });

  it('keeps every width of one subject under one declaration, so a shard holds them together', () => {
    const widened = widthsOf(
      { subjects: [{ subject: { id: 'route/home' } }, { subject: { id: 'story:card' }, declaredIn: 'src/card.stories.jsx' }] },
      [375, 800],
      RUN,
    );

    expect(widened.subjects.map((planned) => planned.declaredIn)).toEqual([
      'route/home',
      'route/home',
      'src/card.stories.jsx',
      'src/card.stories.jsx',
    ]);
  });

  it('returns the plan itself when no width is declared, so removing `widths` gives the old ids back', () => {
    expect(widthsOf(plan, undefined, RUN)).toBe(plan);
    expect(widthsOf(plan, [], RUN)).toBe(plan);
  });
});

describe('unwidened', () => {
  it('strips only a suffix one of the declared widths could have added', () => {
    expect(unwidened('route/home@375', [375, 1280])).toBe('route/home');
    expect(unwidened('route/page@2x', [375, 1280])).toBe('route/page@2x');
    expect(unwidened('route/home@768', [375, 1280])).toBe('route/home@768');
    expect(unwidened('route/home@375', undefined)).toBe('route/home@375');
  });
});
