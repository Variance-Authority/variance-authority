import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over a module a file reaches only through TypeScript's
 * `import()` type: `import('./math.js').addTax` takes one name off the module,
 * and `typeof import('./math.js')` is the type argument a `vi.mock` factory
 * passes its original. Both are type-only imports the compiler resolves as
 * `import type` resolves. What the original returns is TypeScript's answer, so
 * the value the factory reads off and spreads holds no module, and the factory
 * reads no name of it.
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

  it('does not list the test whose mock factory passes the whole module type to a call, for any name', async () => {
    checkout(TYPED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const name of ['addTax', 'roundTax']) {
      const { code, out } = await run(['ask', 'uses', '--name', name]);
      expect(code).toBe(EXIT_CLEAN);
      expect(out).not.toMatch(/math\.test\.ts/);
    }
    const { out } = await run(['ask', 'uses', '--name', 'roundTax']);
    expect(out).not.toMatch(/rate\.ts/);
  });
});
