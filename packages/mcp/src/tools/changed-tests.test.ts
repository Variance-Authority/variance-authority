import { describe, expect, it } from 'vitest';
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import { changedTests } from './changed-tests.js';

const INDEX: ExecutionIndex = {
  tests: [
    { id: 'guest', file: 'test/cart.test.ts', name: 'uses the guest price' },
    { id: 'staff', file: 'test/cart.test.ts', name: 'applies the staff discount' },
  ],
  modules: [{
    file: 'src/cart/total.ts',
    blocks: [
      {
        kind: 'function', name: 'priceOf', path: 'entry', startLine: 1, endLine: 6, source: true,
        crossings: [{ test: 0, distance: 2 }, { test: 1, distance: 1 }],
      },
      {
        kind: 'branch', name: 'priceOf', path: 'if#0/else', startLine: 8, endLine: 10, source: true,
        crossings: [],
      },
    ],
  }],
};

const diff = (file: string, line: number): string => [
  `--- a/${file}`,
  `+++ b/${file}`,
  `@@ -${line},1 +${line},1 @@`,
  '-  const before = 1;',
  '+  const after = 2;',
].join('\n');

describe('variance_changed_tests', () => {
  it('counts the regions a reviewer acts on before listing any of them', () => {
    const text = changedTests.run(INDEX, { diff: diff('src/cart/total.ts', 9) });

    expect(text.split('\n')[0]).toBe(
      '1 changed file(s), 1 changed region(s): 1 that no case covered, 0 that one case alone covered.',
    );
    expect(text).toContain('8-10 branch priceOf — no case covered this region');
  });

  it('names the cases that entered a changed region, nearest first', () => {
    const text = changedTests.run(INDEX, { diff: diff('src/cart/total.ts', 3) });

    expect(text).toContain('1-6 function priceOf — 2 cases');
    expect(text.indexOf('applies the staff discount')).toBeLessThan(text.indexOf('uses the guest price'));
  });

  it('answers a changed test file with the cases it declares, not with silence', () => {
    const text = changedTests.run(INDEX, { diff: diff('test/cart.test.ts', 4) });

    expect(text).toContain('a test file — 2 named case(s) declared here');
    expect(text).not.toContain('no row');
  });

  it('says a changed file has no row rather than reporting it uncovered', () => {
    expect(changedTests.run(INDEX, { diff: diff('src/cart/tax.ts', 2) }))
      .toContain('no row — the indexed run never loaded this file');
  });

  it('says so when a diff names no changed file, rather than reporting a clean change', () => {
    // A mode change and nothing else: real output from `git diff`, and a
    // report of zero findings over it would read as a reviewed change.
    expect(changedTests.run(INDEX, { diff: 'old mode 100644\nnew mode 100755\n' }))
      .toContain('names no changed file');
    expect(() => changedTests.run(INDEX, { diff: '' })).toThrow(/non-empty string/);
  });
});
