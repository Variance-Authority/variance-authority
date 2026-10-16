import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask dependents`: what rests on a file or a name, through imports
 * at any depth, each with the chain that reaches it.
 *
 * `@acme/lib`'s entry passes on both `greet` and `roundTax`. `rounding.ts`
 * imports `roundTax` through it, so it rests on the entry file and on what the
 * entry re-exports, and not on the name `greet`: a change travels by use.
 * `shell.ts` reaches `greet` only through a type import.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-dependents-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const CHAINED = {
  'packages/lib/src/index.ts': "export { greet } from './greet.js';\nexport { roundTax } from './internal/math.js';\n",
  'apps/app/src/page.ts': "import { hello } from './hello';\nexport type Page = string;\nexport const page = hello;\n",
  'apps/app/src/shell.ts': "import type { Page } from './page';\nexport const shell = (page: Page): Page => page;\n",
  'apps/app/src/rounding.ts': "import { roundTax } from '@acme/lib';\nexport const rounded = roundTax(2);\n",
};

describe('variance ask dependents', () => {
  it('answers a name from the lines that import it, then every file that reaches those', async () => {
    checkout(CHAINED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'dependents', '--name', 'greet']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('3 files reach `greet` through their imports');
    expect(out).toContain('1 import away:\napps/app/src/hello.ts:1 imports `greet`');
    expect(out).toContain('2 imports away:\napps/app/src/page.ts → apps/app/src/hello.ts:1 imports `greet`');
    expect(out).toContain('3 imports away:\napps/app/src/shell.ts (type import) → apps/app/src/page.ts → apps/app/src/hello.ts:1 imports `greet`');
    expect(out).not.toContain('rounding.ts');
  });

  it('answers a file from every file that imports it, through a barrel too', async () => {
    checkout(CHAINED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'dependents', '--file', 'packages/lib/src/greet.ts']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('1 import away:\npackages/lib/src/index.ts');
    expect(out).toContain('apps/app/src/rounding.ts → packages/lib/src/index.ts (re-export) → packages/lib/src/greet.ts');
    expect(out).toContain('apps/app/src/shell.ts (type import) → apps/app/src/page.ts → apps/app/src/hello.ts → packages/lib/src/index.ts (re-export) → packages/lib/src/greet.ts');
  });

  it('refuses without a subject', async () => {
    checkout(CHAINED);
    const { code, err } = await run(['ask', 'dependents']);
    expect(code).not.toBe(EXIT_CLEAN);
    expect(err).toContain('`dependents` needs a subject');
  });
});
