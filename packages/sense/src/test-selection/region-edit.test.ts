import { describe, expect, it } from 'vitest';
import { NO_OWNER } from './format-layout.js';
import { editsBetween, landedThrough, NO_EDIT } from './region-edit.js';

/** A module of regions the callers' names are no part of: kind and lines only. */
const module = (...lines: readonly [kind: string, start: number, end: number][]) => ({
  blocks: lines.map(([kind, startLine, endLine]) => ({ kind, name: 'useEffect.arg0', path: 'c/useEffect.arg0', startLine, endLine, source: true })),
});

describe('landedThrough', () => {
  it('lands each region on the one at its lines when the text did not change', () => {
    const regions = module(['module', 1, 9], ['function', 2, 4], ['function', 6, 8]);

    expect([...landedThrough(regions, regions, NO_EDIT).lands]).toEqual([0, 1, 2]);
  });

  it('lands nothing when the edit could not be had, which reads the module as changed whole', () => {
    const regions = module(['module', 1, 9], ['function', 2, 4]);

    expect([...landedThrough(regions, regions, undefined).lands]).toEqual([-1, -1]);
  });

  it('parts same-named regions by the lines the edit places them at, not by their order', () => {
    // The first of two same-named callbacks is deleted and one written behind the second.
    const held = module(['module', 1, 11], ['function', 2, 4], ['function', 6, 10]);
    const recorded = module(['module', 1, 11], ['function', 2, 6], ['function', 8, 10]);
    const deletion = { oldStart: 2, oldCount: 4, newStart: 1, newCount: 0 };
    const insertion = { oldStart: 11, oldCount: 0, newStart: 7, newCount: 3 };

    // The survivor stands at 2-6 now, the new callback is written, and the module changed.
    expect([...landedThrough(held, recorded, { hunks: [deletion, insertion] }).lands]).toEqual([-1, 2, -1]);
    // Read as reaching nothing that runs, the written callback stands where the
    // survivor's address stood, which the survivor holds at its lines: it takes
    // what the module around it took, never the survivor's cases.
    const owned = { ...recorded, owner: Uint32Array.from([NO_OWNER, 0, 0]) };
    expect([...landedThrough(held, owned, { hunks: [deletion, insertion], reading: 'none' }).lands]).toEqual([0, 2, 0]);
  });

  it('carries nothing onto a region whose own lines the edit rewrote, nor the regions around it', () => {
    const held = module(['module', 1, 9], ['function', 2, 4], ['function', 6, 8]);
    const rewritten = { oldStart: 7, oldCount: 1, newStart: 7, newCount: 1 };

    expect([...landedThrough(held, held, { hunks: [rewritten] }).lands]).toEqual([-1, 1, -1]);
  });

  it('leaves a region whole that a line written right after it does not touch', () => {
    const held = module(['module', 1, 9], ['function', 2, 4], ['function', 6, 8]);
    const after = { oldStart: 4, oldCount: 0, newStart: 5, newCount: 2 };
    const recorded = module(['module', 1, 11], ['function', 2, 4], ['function', 8, 10]);

    expect([...landedThrough(held, recorded, { hunks: [after] }).lands]).toEqual([-1, 1, 2]);
  });

  it('lands every region on its own when the edit changes nothing that runs, though a comment moved their lines', () => {
    // A comment line written inside the module after the first function, and one inside the second.
    const held = module(['module', 1, 9], ['function', 2, 4], ['function', 6, 8]);
    const recorded = module(['module', 1, 11], ['function', 2, 4], ['function', 7, 10]);
    const comments = [{ oldStart: 5, oldCount: 0, newStart: 6, newCount: 1 }, { oldStart: 6, oldCount: 0, newStart: 8, newCount: 1 }];

    expect([...landedThrough(held, recorded, { hunks: comments }).lands]).toEqual([-1, 1, -1]);
    expect([...landedThrough(held, recorded, { hunks: comments, reading: 'none' }).lands]).toEqual([0, 1, 2]);
  });

  it('pairs by address when the edit changes nothing that runs but the two cuts hold other regions', () => {
    const held = module(['module', 1, 9], ['function', 2, 4]);
    const recorded = module(['module', 1, 10], ['function', 2, 4], ['function', 6, 8]);
    const written = { oldStart: 5, oldCount: 0, newStart: 6, newCount: 1 };

    // The top level ran as it did, so its own region lands; the third region is
    // born, and the cut names no region around it to take cases from.
    expect([...landedThrough(held, recorded, { hunks: [written], reading: 'none' }).lands]).toEqual([0, 1, -1]);
  });

  it('lands the top level when the edit changed function bodies only, and not the body it changed', () => {
    const held = module(['module', 1, 9], ['function', 2, 4], ['function', 6, 8]);
    const rewritten = { oldStart: 7, oldCount: 1, newStart: 7, newCount: 1 };

    expect([...landedThrough(held, held, { hunks: [rewritten], reading: 'bodies' }).lands]).toEqual([0, 1, -1]);
    expect([...landedThrough(held, held, { hunks: [rewritten], reading: 'load' }).lands]).toEqual([-1, 1, -1]);
  });

  it('names the held region whose cases did not land on a region the edit reached', () => {
    const held = module(['module', 1, 9], ['function', 2, 4], ['function', 6, 8]);
    const rewritten = { oldStart: 7, oldCount: 1, newStart: 7, newCount: 1 };

    // A body edit reaches the body it changed, whose cases ran another text there.
    expect([...landedThrough(held, held, { hunks: [rewritten], reading: 'bodies' }).overwrote]).toEqual([-1, -1, 2]);
    // An edit read as reaching everything reaches the top level too, and leaves the untouched body landed.
    expect([...landedThrough(held, held, { hunks: [rewritten] }).overwrote]).toEqual([0, -1, 2]);
  });

  it('pairs a region the edit moved by its address, and a born one takes the cases around it, where nothing that runs changed', () => {
    const at = (kind: string, name: string, path: string, startLine: number, endLine: number) =>
      ({ kind, name, path, startLine, endLine, source: true });
    const held = { blocks: [at('module', '', '', 1, 9), at('function', 'f', '', 2, 4), at('function', 'g', '', 6, 8)] };
    // A line written inside `g`, and a region the cut gained inside it.
    const recorded = {
      blocks: [at('module', '', '', 1, 10), at('function', 'f', '', 2, 4), at('function', 'g', '', 6, 9), at('branch', 'g', 'if#0', 7, 8)],
      owner: Uint32Array.from([NO_OWNER, 0, 0, 2]),
    };
    const written = { oldStart: 6, oldCount: 0, newStart: 7, newCount: 1 };

    expect([...landedThrough(held, recorded, { hunks: [written], reading: 'none' }).lands]).toEqual([0, 1, 2, 2]);
    // Under a body edit only the top level is spared: `g` and what it gained are reached.
    expect([...landedThrough(held, recorded, { hunks: [written], reading: 'bodies' }).lands]).toEqual([0, 1, -1, -1]);
  });

  it('gives a born region inside one of two same-named callbacks what the function around them took, where the held cut lacked one of them', () => {
    const at = (kind: string, name: string, path: string, startLine: number, endLine: number) =>
      ({ kind, name, path, startLine, endLine, source: true });
    // The held cut lacks the first of two callbacks given to `useEffect`.
    const held = {
      blocks: [at('module', '', '', 1, 14), at('function', 'c', '', 2, 13), at('function', 'c/useEffect.arg0', '', 8, 11)],
      owner: Uint32Array.from([NO_OWNER, 0, 1]),
    };
    // The fresh cut holds both, a branch the first one gained, and a comment
    // written inside the second moved its end.
    const recorded = {
      blocks: [
        at('module', '', '', 1, 15),
        at('function', 'c', '', 2, 14),
        at('function', 'c/useEffect.arg0', '', 3, 6),
        at('branch', 'c/useEffect.arg0', 'if#0', 4, 5),
        at('function', 'c/useEffect.arg0', '', 8, 12),
      ],
      owner: Uint32Array.from([NO_OWNER, 0, 1, 2, 1]),
    };
    const comment = { oldStart: 8, oldCount: 0, newStart: 9, newCount: 1 };

    // Neither callback names one region in both cuts, so each takes `c`'s cases,
    // and so does the branch born inside the first: never the held callback's.
    expect([...landedThrough(held, recorded, { hunks: [comment], reading: 'none' }).lands]).toEqual([0, 1, 1, 1, 1]);
  });

  it('pairs by address only what a renumbered counter does not count', () => {
    const at = (kind: string, path: string, startLine: number, endLine: number) =>
      ({ kind, name: 'f', path, startLine, endLine, source: true });
    // The first of two branches is deleted, so the survivor is cut as `if#0`.
    const held = { blocks: [at('function', '', 1, 9), at('branch', 'if#0', 2, 4), at('branch', 'if#1', 6, 8)] };
    const recorded = { blocks: [at('function', '', 1, 6), at('branch', 'if#0', 3, 5)] };
    const deletion = { oldStart: 2, oldCount: 3, newStart: 1, newCount: 0 };

    // The function passes through no counter the deletion changed, so it is the same region; the survivor is not `if#0` at the base.
    expect([...landedThrough(held, recorded, { hunks: [deletion], reading: 'none' }).lands]).toEqual([0, 2]);
  });

  it('pairs no repeated address by occurrence where the two cuts hold it a different number of times', () => {
    const at = (kind: string, name: string, startLine: number, endLine: number) =>
      ({ kind, name, path: '', startLine, endLine, source: true });
    // The held cut lacks the first of two callbacks given to `useEffect`; it holds the second.
    const held = {
      blocks: [at('module', '', 1, 12), at('function', 'c', 2, 11), at('function', 'c/useEffect.arg0', 7, 9)],
      owner: Uint32Array.from([NO_OWNER, 0, 1]),
    };
    // The fresh cut holds both, and a comment written inside the second moved its end.
    const recorded = {
      blocks: [at('module', '', 1, 13), at('function', 'c', 2, 12), at('function', 'c/useEffect.arg0', 3, 5), at('function', 'c/useEffect.arg0', 7, 10)],
      owner: Uint32Array.from([NO_OWNER, 0, 1, 1]),
    };
    const comment = { oldStart: 7, oldCount: 0, newStart: 8, newCount: 1 };

    // The first callback is not the held one: the held cut's first occurrence is
    // the source's second. Neither callback has an identity here, so each takes
    // the cases of `c` around it, never the second callback's alone.
    expect([...landedThrough(held, recorded, { hunks: [comment], reading: 'none' }).lands]).toEqual([0, 1, 1, 1]);
  });

  it('pairs the top level when a branch deletion renumbers its siblings and moves every span', () => {
    const at = (kind: string, path: string, startLine: number, endLine: number) =>
      ({ kind, name: kind === 'module' ? '' : 'f', path, startLine, endLine, source: true });
    const held = { blocks: [at('module', '', 1, 12), at('function', '', 2, 11), at('branch', 'if#0', 3, 5), at('branch', 'if#1', 7, 9)] };
    // The first branch is deleted from `f`'s body, so the survivor is cut as `if#0`.
    const recorded = { blocks: [at('module', '', 1, 9), at('function', '', 2, 8), at('branch', 'if#0', 4, 6)] };
    const deletion = { oldStart: 3, oldCount: 3, newStart: 2, newCount: 0 };

    // The module is one per file whatever its counters did, and a body edit spares what it does at load.
    expect([...landedThrough(held, recorded, { hunks: [deletion], reading: 'bodies' }).lands]).toEqual([0, -1, 3]);
    expect([...landedThrough(held, recorded, { hunks: [deletion], reading: 'load' }).lands]).toEqual([-1, -1, 3]);
  });

  it('never lands a region on one of another kind at the same lines', () => {
    const held = module(['function', 2, 4]);
    const recorded = module(['branch', 2, 4]);

    expect([...landedThrough(held, recorded, NO_EDIT).lands]).toEqual([-1]);
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
