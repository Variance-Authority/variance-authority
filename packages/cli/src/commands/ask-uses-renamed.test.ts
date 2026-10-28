import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, paragraph, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over a declaration an entry publishes under another
 * name. A declaration is the binding a file declares, not the name a door
 * spells, so the answer keeps each binding's importers to that binding and
 * names the other spelling.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-renamed-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

// `greet.ts` declares `greet` and `salute`; the entry publishes `greet` as `salute`.
const RENAMED = {
  'packages/lib/src/index.ts': "export { greet as salute } from './greet.js';\n",
  'packages/lib/src/greet.ts': 'export function greet(name: string): string {\n  return name;\n}\nexport const salute = 1;\n',
  'apps/app/src/hello.ts': "import { salute } from '@acme/lib';\nexport const hello = salute('app');\n",
  'packages/lib/src/own-salute.ts': "import { salute } from './greet.js';\nexport const own = salute + 1;\n",
};

async function uses(name: string): Promise<string> {
  const { code, out, err } = await run(['ask', 'uses', '--name', name]);
  expect(err).toBe('');
  expect(code).toBe(EXIT_CLEAN);
  return out;
}

describe('variance ask uses over a declaration published under another name', () => {
  it('answers two declarations one file holds when a door spells one under the other name', async () => {
    checkout(RENAMED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses('salute');
    const [published, namesake] = out.split(/^`salute` is exported, without being published, at packages\/lib\/src\/greet\.ts:4 as well, which is another declaration\.$/m);
    expect(namesake).toBeDefined();
    expect(published).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app; used on line 2$/m);
    expect(published).not.toMatch(/own-salute\.ts/);
    expect(namesake).toMatch(/^packages\/lib\/src\/own-salute\.ts:1 — @acme\/lib; used on line 2$/m);
    expect(namesake).not.toMatch(/hello\.ts/);
  });

  it('names the declared name of a declaration a door publishes under another', async () => {
    checkout(RENAMED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const [headline] = (await uses('salute')).split('\n');
    expect(headline).toMatch(/^`salute` \[function\] is imported in 1 place, from another package, published by @acme\/lib, declared as `greet` at packages\/lib\/src\/greet\.ts:1\.$/);
  });

  it('names the door that publishes a declaration under another name when asked by its declared name', async () => {
    checkout(RENAMED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses('greet');
    expect(out).not.toMatch(/without being published/);
    const [headline] = out.split('\n');
    expect(headline).toMatch(/^`greet` \[function\] is imported in 1 place, from another package, published by @acme\/lib as `salute`/);
    expect(paragraph(out, /^`greet` \[function\]/)).toBeDefined();
  });
});
