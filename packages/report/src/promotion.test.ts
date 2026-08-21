import { describe, expect, it } from 'vitest';
import type { ObservationRecord } from './format.js';
import { promotionOf, selectByShape, whyNotWhole } from './promotion.js';

/**
 * These rules used to live inside `accept`, where the only way to ask them was
 * to promote something.
 *
 * They are asserted here now because a second caller exists — an agent asking
 * *what would accepting this record* — and the whole value of that answer is
 * that it cannot disagree with the command. So what is pinned below is the part
 * two callers could drift on: which subjects are refused, and in which order the
 * refusals are decided.
 */

const changed = (subject: string, extra: Partial<ObservationRecord> = {}): ObservationRecord => ({
  subject,
  verdict: 'changed',
  because: 'pixels moved',
  changedPixels: 10,
  regions: [],
  images: { after: `candidates/${subject}.png` },
  ...extra,
});

describe('what may become a baseline', () => {
  it('promotes a changed subject and carries the candidate it would promote', () => {
    const promotion = promotionOf(changed('story:a'));

    expect(promotion.kind).toBe('promotable');
    // The candidate rides on the answer rather than being read again by the
    // caller: two readings of one fact are two answers waiting to differ.
    expect(promotion.kind === 'promotable' && promotion.from).toBe('candidates/story:a.png');
  });

  it('keeps "already the baseline" apart from "refused"', () => {
    const promotion = promotionOf({
      subject: 'story:a',
      verdict: 'unchanged',
      because: '',
      changedPixels: 0,
      regions: [],
    });

    // Not a refusal. The two hundred and ninety-eight subjects a run did not
    // change are the ordinary case, and printing them as failures buries the
    // handful that are.
    expect(promotion.kind).toBe('already-baseline');
  });

  it('asks about instability before it asks about the verdict', () => {
    const promotion = promotionOf({
      subject: 'story:a',
      verdict: 'unchanged',
      because: '',
      changedPixels: 0,
      regions: [],
      unstable: { components: [], bands: ['content'], because: 'two readings disagreed' },
    });

    // A subject that read two ways and settled on `unchanged` is not a subject
    // that did not change — the same baseline was reached twice and answered
    // twice. "Already the baseline" here would hide the only diagnostic that
    // makes it refusable.
    expect(promotion.kind).toBe('refused');
    expect(promotion.kind === 'refused' && promotion.because).toContain('two readings disagreed');
  });

  it('does not refuse instability a declaration absorbed', () => {
    const promotion = promotionOf(
      changed('story:a', {
        unstable: {
          components: [],
          bands: ['texture'],
          because: 'two readings disagreed',
          absorbed: { rule: 'sensitivity', level: 'layout' },
        },
      }),
    );

    // A route declared `layout` said in its config that it does not assert on
    // what the page is painted with. Refusing here would make the declaration
    // worthless.
    expect(promotion.kind).toBe('promotable');
  });

  it('refuses a difference that vanishes in a clean world', () => {
    const promotion = promotionOf(
      changed('story:a', {
        alone: { reproduced: false, because: 'the difference is gone when it runs alone' },
      }),
    );

    expect(promotion.kind).toBe('refused');
    expect(promotion.kind === 'refused' && promotion.because).toContain(
      'Accepting it would make the leak the baseline',
    );
  });

  it('sends an incomparable baseline somewhere different from a missing render', () => {
    const incomparable = promotionOf({
      subject: 'story:a',
      verdict: 'incomparable',
      because: 'baseline from another machine',
      changedPixels: 0,
      regions: [],
    });
    const unrendered = promotionOf(changed('story:b', { images: {} }));

    // Opposite causes: one is a decision about machines, the other is a re-run.
    // One sentence would serve neither.
    expect(incomparable.kind === 'refused' && incomparable.because).toContain(
      'its baseline belongs to another machine',
    );
    expect(unrendered.kind === 'refused' && unrendered.because).toContain(
      'the run recorded no image for it',
    );
  });
});

describe('which subjects one shape can settle', () => {
  const region = (fingerprint?: string) => ({
    x: 0, y: 0, width: 4, height: 4, pixels: 16, cause: true,
    ...(fingerprint === undefined ? {} : { fingerprint }),
  });

  const OBSERVATIONS: readonly ObservationRecord[] = [
    changed('story:whole', { regions: [region('v1:aaa')] }),
    changed('story:mixed', { regions: [region('v1:aaa'), region('v1:bbb')] }),
    changed('story:unnamed', { regions: [region('v1:aaa'), region()] }),
    changed('story:elsewhere', { regions: [region('v1:bbb')] }),
    changed('story:regionless', { regions: [] }),
    changed('story:capped', {
      regions: [region('v1:aaa')],
      truncated: { regions: 3, pixels: 900 },
    }),
  ];

  it('splits whole from partial and leaves regionless subjects out of both', () => {
    const selected = selectByShape(OBSERVATIONS, new Set(['v1:aaa']));

    expect(selected.whole.map((observation) => observation.subject)).toEqual(['story:whole']);
    expect(selected.partial.map((observation) => observation.subject)).toEqual([
      'story:mixed',
      'story:unnamed',
      'story:capped',
    ]);
    // A subject with no region is not evidence about this shape in either
    // direction, so it is in neither list.
    expect([...selected.whole, ...selected.partial].map((o) => o.subject)).not.toContain(
      'story:regionless',
    );
  });

  it('refuses a subject whose region list was capped, however its regions look', () => {
    // Regions the run found and chose not to record could be anything. "Every
    // recorded region carries this shape" is not "this shape is the whole change".
    expect(whyNotWhole(OBSERVATIONS[5] as ObservationRecord)).toContain('capped its region list');
    expect(whyNotWhole(OBSERVATIONS[1] as ObservationRecord)).toContain(
      'something else changed too',
    );
  });
});
