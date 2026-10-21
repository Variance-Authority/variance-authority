import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over a module a file reaches only through TypeScript's
 * `import()` type: `import('./math.js').addTax` takes one name off the module,
 * and `typeof import('./math.js')` types the value a `vi.mock` factory's
 * original returns. Both are type-only imports the compiler resolves as
 * `import type` resolves. The factory reads off that value and spreads it, so
 * it may read every name of the module, and the row names the spread.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-import-type-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const TYPED = {
  'packages/lib/src/internal/math.test.ts': [
    "vi.mock('./math.js', async (original) => {",
    "  const actual = await original<typeof import('./math.js')>();",
    '  return { ...actual, addTax: (...args: Parameters<typeof actual.addTax>) => actual.addTax(...args) };',
    '});',
    '',
  ].join('\n'),
  'packages/lib/src/internal/rate.ts': "export type Taxed = ReturnType<typeof import('./math.js').addTax>;\n",
};

describe('variance ask uses over an `import()` type', () => {
  it('lists a file that takes the name off the module in an `import()` type, as a type use', async () => {
    checkout(TYPED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'addTax']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).not.toContain('which loads the module when the call runs');
    expect(out).toMatch(/^packages\/lib\/src\/internal\/rate\.ts:1 — @acme\/lib \(type only\) \(import\(\) on line 1\)$/m);
  });

  it('lists the test that hands the whole module type to a mock factory, for every name of the module', async () => {
    checkout(TYPED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const name of ['addTax', 'roundTax']) {
      const { code, out } = await run(['ask', 'uses', '--name', name]);
      expect(code).toBe(EXIT_CLEAN);
      expect(out).toMatch(/^packages\/lib\/src\/internal\/math\.test\.ts:3 — @acme\/lib \(type only\) \(import\(\) on line 2, passed on whole: may read it\)$/m);
    }
    const { out } = await run(['ask', 'uses', '--name', 'roundTax']);
    expect(out).not.toMatch(/rate\.ts/);
  });
});
