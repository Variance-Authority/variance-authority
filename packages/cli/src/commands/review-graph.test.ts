import { describe, expect, it } from 'vitest';
import { changeGraph } from './review-graph.js';
import type { Review, ReviewRegion } from './review.js';

const region = (name: string, startLine: number, reach: ReviewRegion['reach'], tests: readonly string[] = [], written = true): ReviewRegion => ({
  kind: name === '' ? 'module' : 'function',
  name,
  startLine,
  endLine: startLine + 5,
  reach,
  written,
  cases: tests.length,
  tests,
});

const review = (regions: readonly ReviewRegion[]): Review =>
  ({ from: 'abc', base: 'since', files: [{ file: 'src/caps.ts', regions }] }) as unknown as Review;

describe('the changed functions drawn for a comment', () => {
  it('draws each changed function under its file, coloured by reach, with the case count', () => {
    const text = changeGraph(review([region('cappedLayers', 10, 'near', ['a.test.ts', 'b.test.ts']), region('cappedPackages', 30, 'unwalked')])).join('\n');
    expect(text).toContain('subgraph f');
    expect(text).toContain('"🟢 cappedLayers · new<br/>2 cases"]:::near');
    expect(text).toContain('"🔴 cappedPackages · new<br/>no case"]:::none');
  });

  it('draws an edge from each test file the record names for the function, and none into a function no case reached', () => {
    const text = changeGraph(review([region('cappedLayers', 10, 'near', ['src/caps.test.ts']), region('cappedPackages', 30, 'unwalked')])).join('\n');
    expect(text).toContain('(["caps.test.ts"])');
    expect(text.match(/-->/gu)).toHaveLength(1);
  });

  it('points a test file at the file once when it reaches every function there a case reached', () => {
    const both = ['a.test.ts', 'b.test.ts'];
    const text = changeGraph(review([region('f', 1, 'near', both), region('g', 10, 'near', both), region('h', 20, 'unwalked')])).join('\n');
    expect(text.match(/-->/gu)).toHaveLength(2);
    expect(text).toMatch(/t\d+ --> f\d+/u);
  });

  it('keeps a function its own colour and count when only a closure inside it has no case', () => {
    const text = changeGraph(review([region('f', 1, 'near', ['f.test.ts', 'g.test.ts']), region('f/map.arg0', 2, 'unwalked')])).join('\n');
    expect(text).toContain('"🟢 f · new<br/>2 cases · 1 closure no case"]:::near');
    expect(text).not.toContain('with no case</summary>');
  });

  it('folds the diagram under a summary that counts the functions and the ones with no case', () => {
    const text = changeGraph(review([region('a', 1, 'near', ['a.test.ts']), region('b', 20, 'unwalked')])).join('\n');
    expect(text).toContain('<summary>🔀 2 changed functions, 1 with no case</summary>');
    expect(text.trimEnd().endsWith('</details>')).toBe(true);
  });

  it('draws nothing when only a module top level changed', () => {
    expect(changeGraph(review([region('', 1, 'loaded', ['a.test.ts'])]))).toEqual([]);
  });

  it('writes a quote, a backtick and a line break in a name as entities, so the label stays one label', () => {
    expect(changeGraph(review([region('a"b`c\nd', 1, 'near', ['a.test.ts'])])).join('\n')).toContain('a#34;b#96;c#10;d');
  });
});
