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
    expect(out.split('\n')[0]).toMatch(/^`shout` \[function\] is imported in 2 places: 1 from another package and 1 inside @acme\/lib, /);
    expect(out).toMatch(/^packages\/lib\/src\/anon-use\.ts:1 — @acme\/lib; used on line 2$/m);
    expect(out).toMatch(/^apps\/app\/src\/anon-deep\.ts:1 — @acme\/app \(as yell\); used on line 2$/m);
  });

  it('answers an anonymous default by every local name an import gives it, not only the nearest', async () => {
    checkout({ ...ANONYMOUS, 'packages/lib/src/a.ts': "import bark from './anon.js';\nexport const b = bark('b');\n" });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const name of ['bark', 'shout', 'yell']) {
      const out = await ask('uses', '--name', name);
      expect(out).not.toMatch(/No file in this workspace declares/);
      expect(out).toMatch(/^packages\/lib\/src\/anon-use\.ts:1 — @acme\/lib/m);
      expect(out).toMatch(/^packages\/lib\/src\/a\.ts:1 — @acme\/lib/m);
      expect(out).toMatch(/^apps\/app\/src\/anon-deep\.ts:1 — @acme\/app/m);
    }
  });

  it('answers, in `ask symbol`, an anonymous default by the name of its nearest import, not as a local name', async () => {
    checkout(ANONYMOUS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await ask('symbol', '--name', 'shout');
    expect(out).toMatch(/^shout \[function\]$/m);
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
    expect(uses.split('\n')[0]).toMatch(/^`default` \[function\] is exported, without being published, at packages\/lib\/src\/lonely\.ts:1, and nothing in this workspace imports it; /);
    const symbol = await ask('symbol', '--name', 'default');
    expect(symbol).toMatch(/^exported, without being published, at packages\/lib\/src\/lonely\.ts:1 by @acme\/lib$/m);
    for (const out of [uses, symbol]) expect(out).not.toMatch(/anon|badge|declared, not exported/);
  });

  it('answers `default` by no export that passes a named default on', async () => {
    checkout({
      'packages/lib/src/badge.ts': 'export default function Badge(label: string): string {\n  return label;\n}\n',
      'packages/lib/src/door-badge.ts': "export { default } from './badge.js';\n",
      'packages/lib/src/lonely.ts': 'export default function (): number {\n  return 1;\n}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    for (const question of ['uses', 'symbol']) expect(await ask(question, '--name', 'default')).not.toMatch(/badge/);
    expect(await ask('symbol', '--name', 'Badge')).toMatch(/^Badge \[function\]$/m);
  });

  it('names an anonymous default no import names by the export that passes it on under a name', async () => {
    checkout({
      'packages/lib/src/thing.ts': 'export default function (): number {\n  return 1;\n}\n',
      'packages/lib/src/door-thing.ts': "export { default as Thing } from './thing.js';\n",
      'packages/lib/src/lonely.ts': 'export default function (): number {\n  return 2;\n}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await ask('symbol', '--name', 'Thing')).toMatch(/^It passes on `Thing`, declared at packages\/lib\/src\/thing\.ts:1:$/m);
    for (const question of ['uses', 'symbol']) expect(await ask(question, '--name', 'default')).not.toMatch(/thing\.ts/);
  });

  it('names, in `ask symbol`, the declaration a local name of an anonymous default imports', async () => {
    checkout({ ...ANONYMOUS, 'apps/app/src/far.ts': "import far from '@acme/lib/src/anon';\nexport const f = far('f');\n" });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await ask('symbol', '--name', 'far');
    expect(out).toContain("`far` is a local name: apps/app/src/far.ts:1 imports `shout` (its `default`) as `far` from '@acme/lib/src/anon'.");
    expect(out).toMatch(/^shout \[function\]$/m);
    expect(out).not.toMatch(/^default/m);
  });

  it('names an anonymous default a barrel passes on unnamed by the import through the barrel, and answers that name', async () => {
    checkout({
      'packages/lib/src/ui/Card.ts': 'export default function (): number {\n  return 2;\n}\n',
      'packages/lib/src/ui/index.ts': "export { default } from './Card.js';\n",
      'apps/app/src/card-use.ts': "import Card from '@acme/lib/src/ui';\nexport const c = Card();\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect((await ask('uses', '--name', 'Card')).split('\n')[0]).toMatch(/^`Card` \[function\] is imported in 1 place, from another package/);
    expect(await ask('symbol', '--name', 'Card')).toMatch(/^Card \[function\]$/m);
  });

  it('answers a published anonymous default by the name of its nearest import, with an import that binds it', async () => {
    checkout({
      'packages/solo/package.json': JSON.stringify({ name: '@acme/solo', main: 'src/anon.ts' }),
      'packages/solo/src/anon.ts': 'export default function (): number {\n  return 3;\n}\n',
      'apps/app/src/solo-use.ts': "import Solo from '@acme/solo';\nexport const z = Solo();\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const symbol = await ask('symbol', '--name', 'Solo');
    expect(symbol).toMatch(/^Solo \[function\]$/m);
    expect(symbol).toContain("import Solo from '@acme/solo';");
    expect(symbol).not.toMatch(/^default|import \{ default \}/m);
    expect((await ask('uses', '--name', 'Solo')).split('\n')[0]).not.toMatch(/as `default`/);
  });
});
