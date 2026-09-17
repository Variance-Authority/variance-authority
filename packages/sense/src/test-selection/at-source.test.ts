import { describe, expect, it } from 'vitest';
import { testsReachingFromView } from './at-source.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import type { TestCoverage } from './index.js';
import { coverage } from './__fixtures__/coverage.js';

const view = (model: TestCoverage = coverage) => openTestCoverage(encodeTestCoverage(model));

/**
 * One module with a declaration, a branch inside it, and a region nobody ran.
 *
 * `cart` is entered by both tests; only `clicks` takes the `then` branch;
 * `render` is a second declaration that `cart` never reaches, and `reads` had it
 * loaded without entering it.
 */
const shaped: TestCoverage = {
  version: 3,
  instrumentation: 'fixture-instrumentation',
  tests: ['test/clicks.test.ts', 'test/reads.test.ts'].map((file) => ({
    file,
    complete: file === 'test/clicks.test.ts',
    preconditions: [{ name: file, digest: `source:${file}` }],
  })),
  modules: [
    {
      file: 'src/cart.ts',
      sourceDigest: 'source:cart',
      instrumented: true,
      blocks: [
        {
          ordinal: 0,
          kind: 'module',
          digest: 'block:root',
          name: '',
          path: 'module',
          startLine: 1,
          endLine: 30,
          source: true,
          testFiles: ['test/clicks.test.ts', 'test/reads.test.ts'],
        },
        {
          ordinal: 1,
          kind: 'function',
          owner: 0,
          digest: 'block:cart',
          name: 'cart',
          path: 'entry',
          startLine: 5,
          endLine: 20,
          source: true,
          testFiles: ['test/clicks.test.ts', 'test/reads.test.ts'],
        },
        {
          ordinal: 2,
          kind: 'branch',
          owner: 1,
          digest: 'block:cart:then',
          name: 'cart',
          path: 'if#0/then',
          startLine: 10,
          endLine: 14,
          source: true,
          testFiles: ['test/clicks.test.ts'],
        },
        {
          ordinal: 3,
          kind: 'function',
          owner: 0,
          digest: 'block:render',
          name: 'render',
          path: 'entry',
          startLine: 22,
          endLine: 29,
          source: true,
          testFiles: [],
          loadedBy: ['test/reads.test.ts'],
        },
      ],
    },
  ],
};

describe('asking one place in the source who goes there', () => {
  it('answers a whole file with every test that entered any of it', () => {
    const answer = testsReachingFromView(view(), { file: 'src/decide.ts' });
    expect(answer.recorded).toBe(true);
    expect(answer.tests.map((test) => test.test)).toEqual([
      'test/alpha.test.ts',
      'test/beta.test.ts',
    ]);
  });

  it('answers a line with the narrowest region holding it, and nothing around it', () => {
    // The distance between this and a selection. A one-line diff at line 4
    // charges the branch *and* the module root, because an edit there may be
    // the enclosing region's text. Asked who *goes* to line 4, the module root
    // is not an answer: beta never took the branch.
    const answer = testsReachingFromView(view(), { file: 'src/decide.ts', line: 4 });
    expect(answer.regions.map((region) => region.path)).toEqual(['if#0/then']);
    expect(answer.tests.map((test) => test.test)).toEqual(['test/alpha.test.ts']);
  });

  it('counts how many tests crossed each region it resolved to', () => {
    const answer = testsReachingFromView(view(shaped), { file: 'src/cart.ts' });
    expect(answer.regions.map((region) => [region.path, region.entered])).toEqual([
      ['if#0/then', 1],
      ['entry', 0],
      ['entry', 2],
      ['module', 2],
    ]);
  });

  it('answers a declaration with the region the declaration is', () => {
    const answer = testsReachingFromView(view(shaped), { file: 'src/cart.ts', function: 'cart' });
    expect(answer.regions).toHaveLength(1);
    expect(answer.regions[0]!.kind).toBe('function');
    expect(answer.tests.map((test) => test.test)).toEqual([
      'test/clicks.test.ts',
      'test/reads.test.ts',
    ]);
  });

  it('answers a branch with the tests that took it', () => {
    const answer = testsReachingFromView(view(shaped), {
      file: 'src/cart.ts',
      function: 'cart',
      branch: 'if#0/then',
    });
    expect(answer.tests.map((test) => test.test)).toEqual(['test/clicks.test.ts']);
  });

  it('separates a test that loaded the code from a test that ran it', () => {
    const answer = testsReachingFromView(view(shaped), { file: 'src/cart.ts', function: 'render' });
    expect(answer.tests).toEqual([]);
    expect(answer.loaded).toEqual(['test/reads.test.ts']);
  });

  it('says whether each answering test is recorded whole', () => {
    const answer = testsReachingFromView(view(shaped), { file: 'src/cart.ts', function: 'cart' });
    expect(answer.tests.map((test) => [test.test, test.complete])).toEqual([
      ['test/clicks.test.ts', true],
      ['test/reads.test.ts', false],
    ]);
  });

  it('tells a file it never recorded from a place it has no region for', () => {
    const missing = testsReachingFromView(view(), { file: 'src/never.ts' });
    expect(missing.recorded).toBe(false);
    expect(missing.regions).toEqual([]);

    const unrecorded = testsReachingFromView(view(), { file: 'src/decide.ts', line: 900 });
    expect(unrecorded.recorded).toBe(true);
    expect(unrecorded.regions).toEqual([]);
    expect(unrecorded.tests).toEqual([]);
  });

  it('hands back reasons in the shape a distance reading consumes', () => {
    const answer = testsReachingFromView(view(), { file: 'src/decide.ts', line: 4 });
    expect(answer.because).toEqual([
      {
        test: 'test/alpha.test.ts',
        via: [
          {
            kind: 'region',
            file: 'src/decide.ts',
            name: 'decide',
            path: 'if#0/then',
            startLine: 3,
            endLine: 5,
          },
        ],
      },
    ]);
  });

  it('refuses a point that addresses a region two ways', () => {
    expect(() => testsReachingFromView(view(), { file: 'src/decide.ts', line: 4, branch: 'if#0/then' }))
      .toThrow(/one/);
  });
});
