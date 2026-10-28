import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import { observabilityToolByName } from '../tools.js';
import { changedTests } from './changed-tests.js';
import { readTree, type Tree } from './tree.js';

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
      '1 changed file, 1 changed region: 1 nothing covered, 0 covered by one case.',
    );
    expect(text).toContain('8-10 branch priceOf — no case covered this region');
  });

  it('names the cases that covered a changed region, nearest first', () => {
    const text = changedTests.run(INDEX, { diff: diff('src/cart/total.ts', 3) });

    expect(text).toContain('1-6 function priceOf — 2 cases');
    expect(text.indexOf('applies the staff discount')).toBeLessThan(text.indexOf('uses the guest price'));
  });

  it('prints what each case said, where it said it, as `variance covering --since` does', () => {
    const index: ExecutionIndex = {
      ...INDEX,
      tests: [INDEX.tests[0]!, {
        ...INDEX.tests[1]!,
        said: JSON.stringify({ said: [['auth:role', '"staff"', 'test/cart.test.ts:4', 1]] }),
      }],
    };
    const text = changedTests.run(index, { diff: diff('src/cart/total.ts', 3) });

    expect(text).toContain('applies the staff discount [staff] — auth:role=staff (test/cart.test.ts:4)');
    expect(text).toMatch(/uses the guest price \[guest\]$/m);
  });

  it('answers a changed test file with the cases it declares, not with silence', () => {
    const text = changedTests.run(INDEX, { diff: diff('test/cart.test.ts', 4) });

    expect(text).toContain('a test file — 2 named cases declared here');
    expect(text).not.toContain('no row');
  });

  it('says a changed file has no row rather than reporting it uncovered', () => {
    expect(changedTests.run(INDEX, { diff: diff('src/cart/tax.ts', 2) }))
      .toContain('no row — the recorded run never loaded this file');
  });

  it('says so when a diff names no changed file, rather than reporting a clean change', () => {
    // A mode change and nothing else: real output from `git diff`, and a
    // report of zero findings over it would read as a reviewed change.
    expect(changedTests.run(INDEX, { diff: 'old mode 100644\nnew mode 100755\n' }))
      .toContain('names no changed file');
    expect(() => changedTests.run(INDEX, { diff: '' })).toThrow(/non-empty string/);
  });
});

describe('variance_changed_tests over the file graph', () => {
  // `cart.test.ts` imports `total.ts` and calls `priceOf`. `mocked.test.ts` mocks
  // it, so the real module ran there only while the runner evaluated it to shape
  // the automock, and nothing in its text reaches that case.
  let root: string;
  let tree: Tree;
  const index: ExecutionIndex = {
    tests: [
      { id: 'real', file: 'test/cart.test.ts', name: 'prices a real cart' },
      { id: 'mocked', file: 'test/mocked.test.ts', name: 'prices against the mock' },
    ],
    modules: [{
      file: 'src/cart/total.ts',
      blocks: [{
        kind: 'function', name: 'priceOf', path: 'entry', startLine: 1, endLine: 3, source: true,
        crossings: [{ test: 0, distance: 1 }, { test: 1, distance: 0, loaded: true }],
      }],
    }],
  };

  const write = (file: string, text: string): void => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'changed-tests-'));
    write('package.json', '{"name":"changed-tests-fixture","private":true}\n');
    write('src/cart/total.ts', 'export function priceOf(n: number): number {\n  return n * 2;\n}\n');
    write('test/cart.test.ts', "import { priceOf } from '../src/cart/total';\nexport const price = priceOf(1);\n");
    write(
      'test/mocked.test.ts',
      "import { vi } from 'vitest';\nimport { priceOf } from '../src/cart/total';\nvi.mock('../src/cart/total');\nexport const price = priceOf(1);\n",
    );
    execFileSync('git', ['-C', root, 'init', '--quiet']);
    execFileSync('git', ['-C', root, 'add', '.']);
    tree = await readTree({ root });
  }, 60_000);

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('asks for the tree, which carries the graph', () => {
    expect(changedTests.wants?.({ diff: diff('src/cart/total.ts', 2) })).toBe(true);
  });

  it('does not list a case whose file mocked the changed module', () => {
    const text = changedTests.run(index, { diff: diff('src/cart/total.ts', 2) }, { tree });

    expect(text).toContain('1-3 function priceOf — 1 case, and it is the only witness\n');
    expect(text).toContain('prices a real cart');
    expect(text).not.toContain('carried in while the module evaluated');
  });

  it('cuts it on the observability connection too, where the tool is lifted onto the execution', () => {
    const lifted = observabilityToolByName('variance_changed_tests')!;
    const input = { diff: diff('src/cart/total.ts', 2) };

    expect(lifted.wants?.(input)).toBe(true);
    expect(lifted.run({ execution: index }, input, { tree })).toBe(changedTests.run(index, input, { tree }));
  });

  it('says it read no file graph when the host supplied none, rather than cutting nothing silently', () => {
    expect(changedTests.run(index, { diff: diff('src/cart/total.ts', 2) }))
      .toContain('No file graph was read');
  });
});
