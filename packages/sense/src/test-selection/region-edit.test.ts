import { describe, expect, it } from 'vitest';
import { editsBetween, landedThrough, NO_EDIT } from './region-edit.js';

/** A module of regions the callers' names are no part of: kind and lines only. */
const module = (...lines: readonly [kind: string, start: number, end: number][]) => ({
  blocks: lines.map(([kind, startLine, endLine]) => ({ kind, name: 'useEffect.arg0', path: 'c/useEffect.arg0', startLine, endLine, source: true })),
});

describe('landedThrough', () => {
  it('lands each region on the one at its lines when the text did not change', () => {
    const regions = module(['module', 1, 9], ['function', 2, 4], ['function', 6, 8]);

    expect([...landedThrough(regions, regions, NO_EDIT)]).toEqual([0, 1, 2]);
  });

  it('lands nothing when the edit could not be had, which reads the module as changed whole', () => {
    const regions = module(['module', 1, 9], ['function', 2, 4]);

    expect([...landedThrough(regions, regions, undefined)]).toEqual([-1, -1]);
  });

  it('parts same-named regions by the lines the edit places them at, not by their order', () => {
    // The first of two same-named callbacks is deleted and one written behind the second.
    const held = module(['module', 1, 11], ['function', 2, 4], ['function', 6, 10]);
    const recorded = module(['module', 1, 11], ['function', 2, 6], ['function', 8, 10]);
    const deletion = { oldStart: 2, oldCount: 4, newStart: 1, newCount: 0 };
    const insertion = { oldStart: 11, oldCount: 0, newStart: 7, newCount: 3 };

    // The survivor stands at 2-6 now, the new callback is written, and the module changed.
    expect([...landedThrough(held, recorded, { hunks: [deletion, insertion] })]).toEqual([-1, 2, -1]);
  });

  it('carries nothing onto a region whose own lines the edit rewrote, nor the regions around it', () => {
    const held = module(['module', 1, 9], ['function', 2, 4], ['function', 6, 8]);
    const rewritten = { oldStart: 7, oldCount: 1, newStart: 7, newCount: 1 };

    expect([...landedThrough(held, held, { hunks: [rewritten] })]).toEqual([-1, 1, -1]);
  });

  it('leaves a region whole that a line written right after it does not touch', () => {
    const held = module(['module', 1, 9], ['function', 2, 4], ['function', 6, 8]);
    const after = { oldStart: 4, oldCount: 0, newStart: 5, newCount: 2 };
    const recorded = module(['module', 1, 11], ['function', 2, 4], ['function', 8, 10]);

    expect([...landedThrough(held, recorded, { hunks: [after] })]).toEqual([-1, 1, 2]);
  });

  it('never lands a region on one of another kind at the same lines', () => {
    const held = module(['function', 2, 4]);
    const recorded = module(['branch', 2, 4]);

    expect([...landedThrough(held, recorded, NO_EDIT)]).toEqual([-1]);
  });
});

describe('editsBetween', () => {
  it('is no edit between a text and itself, and reads no text for it', () => {
    expect(editsBetween('/nowhere', undefined, [])('src/a.ts', 'v1:same', 'v1:same')).toBe(NO_EDIT);
  });

  it('has no edit when a text cannot be found', () => {
    expect(editsBetween('/nowhere', undefined, ['0'.repeat(40)])('src/a.ts', 'v1:one', 'v1:two')).toBeUndefined();
  });
});
