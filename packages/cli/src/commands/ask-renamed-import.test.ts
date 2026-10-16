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
 * it in both directions.
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
});
