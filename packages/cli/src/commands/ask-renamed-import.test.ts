import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask symbol` and `ask uses` over a name an import renames:
 * `import { greet as hail } from './greet.js'`. The import binding the parser
 * read is the one fact that ties `hail` to `greet`, and the answers go through
 * it in both directions, and the original's answer lists its members as the
 * original's own answer does.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-renamed-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const RENAMED = {
  'packages/lib/src/hailed.ts': "import { greet as hail } from './greet.js';\nexport const hailed = hail('lib');\n",
  'apps/app/src/welcome.ts': "import { greet as welcome } from '@acme/lib';\nexport const welcomed = welcome('app');\n",
  'packages/lib/src/inner.ts': 'export const inner = (text: string): string => text;\n',
  'packages/lib/src/shout.ts': "import { inner as shout } from './inner.js';\nexport const shouted = shout('lib');\n",
};

describe('variance ask over a renamed import', () => {
  it('names the local name of every renamed import of a published name in `uses`', async () => {
    checkout(RENAMED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app$/m);
    expect(out).toMatch(/^apps\/app\/src\/welcome\.ts:1 — @acme\/app \(as welcome\)$/m);
    expect(out).toMatch(/^packages\/lib\/src\/hailed\.ts:1 — @acme\/lib \(as hail\)$/m);
  });

  it('names the local name of a renamed import of what a type-only re-export passes on in `uses`', async () => {
    checkout({
      'packages/lib/src/typed.ts': "export type { greet as Greet } from './greet.js';\n",
      'packages/lib/src/called.ts': "import type { Greet as Called } from './typed.js';\nexport type Calling = typeof Called;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^packages\/lib\/src\/called\.ts:1 — @acme\/lib \(as Called\) \(type only\)$/m);
    expect(out).not.toMatch(/typed\.ts/);
  });

  it('names the local name of a renamed import of a name no entry publishes in `uses`', async () => {
    checkout(RENAMED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'inner']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^packages\/lib\/src\/shout\.ts:1 — @acme\/lib \(as shout\)$/m);
  });

  it('names the renamed imports of the original in `symbol`', async () => {
    checkout(RENAMED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const published = await run(['ask', 'symbol', '--name', 'greet']);
    expect(published.code).toBe(EXIT_CLEAN);
    expect(published.out).toContain('Imported under another name: apps/app/src/welcome.ts:1 as `welcome`, packages/lib/src/hailed.ts:1 as `hail`.');

    const unpublished = await run(['ask', 'symbol', '--name', 'inner']);
    expect(unpublished.code).toBe(EXIT_CLEAN);
    expect(unpublished.out).toContain('Imported under another name: packages/lib/src/shout.ts:1 as `shout`.');
  });

  it('answers `symbol` for a local name with the import that renames it and the original it names', async () => {
    checkout(RENAMED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const across = await run(['ask', 'symbol', '--name', 'welcome']);
    expect(across.code).toBe(EXIT_CLEAN);
    expect(across.out).toContain("`welcome` is a local name: apps/app/src/welcome.ts:1 imports `greet` as `welcome` from '@acme/lib'.");
    expect(across.out).toMatch(/packages\/lib\/src\/greet\.ts:1/);

    const relative = await run(['ask', 'symbol', '--name', 'hail']);
    expect(relative.code).toBe(EXIT_CLEAN);
    expect(relative.out).toContain("`hail` is a local name: packages/lib/src/hailed.ts:1 imports `greet` as `hail` from './greet.js'.");
    expect(relative.out).toContain("import { greet } from '@acme/lib'");
    expect(relative.out).not.toContain('without being published');

    const within = await run(['ask', 'symbol', '--name', 'shout']);
    expect(within.code).toBe(EXIT_CLEAN);
    expect(within.out).toContain("`shout` is a local name: packages/lib/src/shout.ts:1 imports `inner` as `shout` from './inner.js'.");
    expect(within.out).toMatch(/packages\/lib\/src\/inner\.ts:1/);
  });

  it('lists the members of the original a local name binds, published or not', async () => {
    checkout({
      'packages/lib/src/index.ts': "export { greet } from './greet.js';\nexport type { Card } from './card.js';\n",
      'packages/lib/src/card.ts': 'export interface Card {\n  title: string;\n}\n',
      'apps/app/src/tile.ts': "import type { Card as Tile } from '@acme/lib';\nexport type Tiles = Tile[];\n",
      'packages/kit/src/money/types.ts': 'export interface Rate {\n  percent: number;\n}\n',
      'packages/kit/src/money/priced.ts': "import type { Rate as Price } from './types.js';\nexport type Cost = Price;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const published = await run(['ask', 'symbol', '--name', 'Tile']);
    expect(published.code).toBe(EXIT_CLEAN);
    expect(published.out).toContain('Members:\npackages/lib/src/card.ts:2 — title: string;');

    const unpublished = await run(['ask', 'symbol', '--name', 'Price']);
    expect(unpublished.code).toBe(EXIT_CLEAN);
    expect(unpublished.out).toContain('Members:\npackages/kit/src/money/types.ts:2 — percent: number;');
  });

  it('answers `symbol` for a local name that is also a member with the import alone, as a member is answered only when nothing else binds the name', async () => {
    checkout({ ...RENAMED, 'packages/lib/src/shape.ts': 'export interface Shape {\n  shout: string;\n}\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'shout']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain("`shout` is a local name: packages/lib/src/shout.ts:1 imports `inner` as `shout` from './inner.js'.");
    expect(out).not.toContain('a member of');
  });
});
