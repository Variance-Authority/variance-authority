import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask` over a declaration its file exports only as `default`.
 * `default` is a slot every file has, not a name: the declaration is named by
 * its own binding, `export default function Badge`, and an anonymous one by
 * the import nearest its file, the one sharing the most leading path segments.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-default-named-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

// `anon.ts` exports a function with no name; `shout` imports it beside it, `yell` from another package.
const ANONYMOUS = {
  'packages/lib/src/anon.ts': 'export default function (name: string): string {\n  return name;\n}\n',
  'packages/lib/src/anon-use.ts': "import shout from './anon.js';\nexport const loud = shout('x');\n",
  'apps/app/src/anon-deep.ts': "import yell from '@acme/lib/src/anon';\nexport const y = yell('y');\n",
};

async function ask(...args: readonly string[]): Promise<string> {
  const { code, out, err } = await run(['ask', ...args]);
  expect(err).toBe('');
  expect(code).toBe(EXIT_CLEAN);
  return out;
}

describe('variance ask over a declaration exported only as default', () => {
  it('names an anonymous default by the import nearest its file, and answers its uses by that name', async () => {
    checkout(ANONYMOUS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await ask('uses', '--name', 'shout');
    expect(out.split('\n')[0]).toMatch(/^`shout` is imported in 2 places: 1 from another package and 1 inside @acme\/lib, /);
    expect(out).toMatch(/^packages\/lib\/src\/anon-use\.ts:1 — @acme\/lib; used on line 2$/m);
    expect(out).toMatch(/^apps\/app\/src\/anon-deep\.ts:1 — @acme\/app \(as yell\); used on line 2$/m);
  });

  it('answers, in `ask symbol`, an anonymous default by the name of its nearest import, not as a local name', async () => {
    checkout(ANONYMOUS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await ask('symbol', '--name', 'shout');
    expect(out).toMatch(/^shout$/m);
    expect(out).toMatch(/^Imported in 2 places; /m);
    expect(out).toMatch(/^exported, without being published, at packages\/lib\/src\/anon\.ts:1 by @acme\/lib$/m);
    expect(out).not.toMatch(/`shout` is a local name/);
  });

  it('names a default export by the name its declaration binds', async () => {
    checkout({
      'packages/lib/src/badge.ts': 'export default function Badge(label: string): string {\n  return label;\n}\n',
      'packages/lib/src/badge-use.ts': "import Btn from './badge.js';\nexport const b = Btn('x');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const uses = await ask('uses', '--name', 'Badge');
    expect(uses.split('\n')[0]).toMatch(/^`Badge` \[function\] is imported in 1 place, inside @acme\/lib, /);
    expect(uses).toMatch(/^packages\/lib\/src\/badge-use\.ts:1 — @acme\/lib \(as Btn\); used on line 2$/m);
    expect(await ask('symbol', '--name', 'Badge')).toMatch(/^Badge \[function\]$/m);
  });

  it('answers `default` by the default exports nothing names, never by a named one', async () => {
    checkout({
      ...ANONYMOUS,
      'packages/lib/src/badge.ts': 'export default function Badge(label: string): string {\n  return label;\n}\n',
      'packages/lib/src/lonely.ts': 'export default function (): number {\n  return 1;\n}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const uses = await ask('uses', '--name', 'default');
    expect(uses.split('\n')[0]).toMatch(/^`default` is exported, without being published, at packages\/lib\/src\/lonely\.ts:1, and nothing in this workspace imports it; /);
    const symbol = await ask('symbol', '--name', 'default');
    expect(symbol).toMatch(/^exported, without being published, at packages\/lib\/src\/lonely\.ts:1 by @acme\/lib$/m);
    for (const out of [uses, symbol]) expect(out).not.toMatch(/anon|badge|declared, not exported/);
  });
});
