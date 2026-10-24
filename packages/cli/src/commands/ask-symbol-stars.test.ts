import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `symbol` counts each export's importers by walking forward from it through
 * the re-exports that pass the name on, and a bare `export *` passes it on only
 * where ECMAScript's export resolution says it does: a file's own export and
 * its named `export … from` decide before its stars, and two stars that reach
 * different declarations pass the name on from neither.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-symbol-stars-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const BASE = {
  'packages/kit/src/money/base.ts': 'export function levy(amount: number): number {\n  return amount;\n}\n',
  'packages/kit/src/money/use-base.ts': "import { levy } from './base.js';\nexport const based = levy(1);\n",
};

/** The block `symbol` prints for the export at `at`, up to the next blank line. */
function block(out: string, at: string): string | undefined {
  return out.split('\n\n').find((one) => one.includes(`exported, without being published, at ${at}`));
}

describe('symbol through a bare `export *`', () => {
  it("lets a file's named `export … from` of the name decide before its star", async () => {
    checkout({
      ...BASE,
      'packages/kit/src/money/shadow.ts': "export * from './base.js';\nexport { taxOf as levy } from './tax.js';\n",
      'packages/kit/src/money/use-shadow.ts': "import { levy } from './shadow.js';\nexport const shadowed = levy(2);\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'levy']);
    expect(code).toBe(EXIT_CLEAN);
    expect(block(out, 'packages/kit/src/money/base.ts:1')).toContain('Imported in 1 place;');
    const shadow = block(out, 'packages/kit/src/money/shadow.ts:2');
    expect(shadow).toContain('It passes on `taxOf`, declared at packages/kit/src/money/tax.ts:1:');
    expect(shadow).toContain('Imported in 1 place;');
  });

  it("lets a file's own export of the name decide before its star", async () => {
    checkout({
      ...BASE,
      'packages/kit/src/money/own.ts': "export * from './base.js';\nexport const levy = (amount: number): number => amount * 2;\n",
      'packages/kit/src/money/use-own.ts': "import { levy } from './own.js';\nexport const owned = levy(2);\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'symbol', '--name', 'levy']);
    expect(block(out, 'packages/kit/src/money/base.ts:1')).toContain('Imported in 1 place;');
    expect(block(out, 'packages/kit/src/money/own.ts:2')).toContain('Imported in 1 place;');
  });

  it('passes the name on from neither of two stars that reach different declarations', async () => {
    checkout({
      ...BASE,
      'packages/kit/src/money/other.ts': 'export function levy(amount: number): number {\n  return -amount;\n}\n',
      'packages/kit/src/money/both.ts': "export * from './base.js';\nexport * from './other.js';\n",
      'packages/kit/src/money/use-both.ts': "import { levy } from './both.js';\nexport const either = levy(3);\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'symbol', '--name', 'levy']);
    expect(block(out, 'packages/kit/src/money/base.ts:1')).toContain('Imported in 1 place;');
    expect(block(out, 'packages/kit/src/money/other.ts:1')).toContain('Nothing in this workspace imports it;');
  });

  it('passes the name on through two stars that reach the same declaration', async () => {
    checkout({
      ...BASE,
      'packages/kit/src/money/again.ts': "export * from './base.js';\n",
      'packages/kit/src/money/twice.ts': "export * from './base.js';\nexport * from './again.js';\n",
      'packages/kit/src/money/use-twice.ts': "import { levy } from './twice.js';\nexport const twiced = levy(4);\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'symbol', '--name', 'levy']);
    expect(block(out, 'packages/kit/src/money/base.ts:1')).toContain('Imported in 2 places;');
  });

  it('passes the name on where another star reaches a module outside the checkout', async () => {
    checkout({
      ...BASE,
      'packages/kit/src/money/outside.ts': "export * from './base.js';\nexport * from 'left-pad';\n",
      'packages/kit/src/money/use-outside.ts': "import { levy } from './outside.js';\nexport const beyond = levy(5);\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'symbol', '--name', 'levy']);
    expect(block(out, 'packages/kit/src/money/base.ts:1')).toContain('Imported in 2 places;');
  });

  it("lets a file's named `export … from` a module outside the checkout decide before its star", async () => {
    checkout({
      ...BASE,
      'packages/kit/src/money/aside.ts': "export * from './base.js';\nexport { levy } from 'left-pad';\n",
      'packages/kit/src/money/use-aside.ts': "import { levy } from './aside.js';\nexport const set = levy(6);\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'symbol', '--name', 'levy']);
    expect(block(out, 'packages/kit/src/money/base.ts:1')).toContain('Imported in 1 place;');
  });

  it('passes the name on from neither of two disagreeing stars, wherever a star outside the checkout stands', async () => {
    checkout({
      ...BASE,
      'packages/kit/src/money/other.ts': 'export function levy(amount: number): number {\n  return -amount;\n}\n',
      'packages/kit/src/money/first.ts': "export * from 'left-pad';\nexport * from './base.js';\nexport * from './other.js';\n",
      'packages/kit/src/money/use-first.ts': "import { levy } from './first.js';\nexport const led = levy(7);\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'symbol', '--name', 'levy']);
    expect(block(out, 'packages/kit/src/money/base.ts:1')).toContain('Imported in 1 place;');
    expect(block(out, 'packages/kit/src/money/other.ts:1')).toContain('Nothing in this workspace imports it;');
  });
});
