import { describe, expect, it } from 'vitest';
import { changeGraph } from './review-graph.js';
import type { Review, ReviewRegion } from './review.js';

const region = (name: string, startLine: number, reach: ReviewRegion['reach'], cases: number, written = true): ReviewRegion => ({
  kind: name === '' ? 'module' : 'function',
  name,
  startLine,
  endLine: startLine + 5,
  reach,
  written,
  cases,
});

const review = (regions: readonly ReviewRegion[], moved: readonly unknown[] = []): Review =>
  ({
    from: 'abc',
    base: 'since',
    files: [{ file: 'src/caps.ts', regions }],
    motion: { moved: { regions: moved, testFiles: [], counts: {}, unread: [] } },
  }) as unknown as Review;

describe('the changed functions drawn for a comment', () => {
  it('draws each changed function under its file, coloured by reach, with the case count', () => {
    const text = changeGraph(review([region('cappedLayers', 10, 'near', 3), region('cappedPackages', 30, 'unwalked', 0)])).join('\n');
    expect(text).toContain('subgraph f');
    expect(text).toContain('"🟢 cappedLayers · new<br/>3 cases"]:::near');
    expect(text).toContain('"🔴 cappedPackages · new<br/>no case"]:::none');
  });

  it('draws an edge from a test file only where a case there now calls into the function', () => {
    const moved = [{ file: 'src/caps.ts', startLine: 10, endLine: 15, now: [{ file: 'src/caps.test.ts' }] }];
    const text = changeGraph(review([region('cappedLayers', 10, 'near', 1), region('cappedPackages', 30, 'unwalked', 0)], moved)).join('\n');
    expect(text).toMatch(/t\d+ --> r\d+/u);
    expect(text.match(/-->/gu)).toHaveLength(1);
    expect(text).toContain('"caps.test.ts"');
  });

  it('counts a nested closure with the function it sits in, at the worst reach', () => {
    const text = changeGraph(review([region('f', 1, 'near', 2), region('f/map.arg0', 2, 'unwalked', 0)])).join('\n');
    expect(text.match(/<br\/>/gu)).toHaveLength(1);
    expect(text).toContain('🔴 f');
  });

  it('folds the diagram under a summary that counts the functions and the ones with no case', () => {
    const text = changeGraph(review([region('a', 1, 'near', 1), region('b', 20, 'unwalked', 0)])).join('\n');
    expect(text).toContain('<summary>🔀 2 changed functions, 1 with no case</summary>');
    expect(text.trimEnd().endsWith('</details>')).toBe(true);
  });

  it('draws nothing when only a module top level changed', () => {
    expect(changeGraph(review([region('', 1, 'loaded', 1)]))).toEqual([]);
  });

  it('writes a quote in a name as an entity, so the label stays one label', () => {
    expect(changeGraph(review([region('a"b', 1, 'near', 1)])).join('\n')).toContain('a#34;b');
  });
});
