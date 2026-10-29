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

  it('names the door that renames what the declaring file exports under another name again', async () => {
    checkout({
      'packages/lib/src/index.ts': "export { hello as salute } from './greet.js';\n",
      'packages/lib/src/greet.ts': 'function greet(name: string): string {\n  return name;\n}\nexport { greet as hello };\n',
      'apps/app/src/hello.ts': "import { salute } from '@acme/lib';\nexport const hello = salute('app');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const [headline] = (await uses('hello')).split('\n');
    expect(headline).toMatch(/^`hello` \[function\] is imported in 1 place, from another package, published by @acme\/lib as `salute`/);
  });

  it('answers one declaration the declaring file exports under another name than it binds', async () => {
    checkout({
      'packages/lib/src/index.ts': "export { salute } from './greet.js';\n",
      'packages/lib/src/greet.ts': 'function greet(name: string): string {\n  return name;\n}\nexport { greet as salute };\n',
      'apps/app/src/hello.ts': "import { salute } from '@acme/lib';\nexport const hello = salute('app');\n",
      'packages/lib/src/inner.ts': "import { salute } from './greet.js';\nexport const inner = salute('lib');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses('salute');
    expect(out).not.toMatch(/another declaration/);
    expect(out).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app; used on line 2$/m);
    expect(out).toMatch(/^packages\/lib\/src\/inner\.ts:1 — @acme\/lib; used on line 2$/m);
  });

  it('counts, in `ask symbol`, each of two bindings one file publishes by its own importers', async () => {
    checkout({
      'packages/lib/src/index.ts': "export { greet as salute, salute as greeting } from './greet.js';\n",
      'packages/lib/src/greet.ts': 'export function greet(name: string): string {\n  return name;\n}\nexport const salute = 1;\n',
      'apps/app/src/hello.ts': "import { salute } from '@acme/lib';\nexport const hello = salute('app');\n",
      'apps/app/src/one.ts': "import { greeting } from '@acme/lib';\nexport const one = greeting;\n",
      'apps/app/src/two.ts': "import { greeting } from '@acme/lib';\nexport const two = greeting;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'salute']);
    expect(code).toBe(EXIT_CLEAN);
    const [greeting, salute] = out.split(/^salute \[function\]$/m);
    expect(salute).toBeDefined();
    expect(salute).toContain('`variance ask uses` names the 1 place that imports this, from another package, nearest to a file you name first.');
    expect(greeting).toContain('`variance ask uses` names the 2 places that import this, all from other packages, nearest to a file you name first.');
  });

  it('lists, in `ask symbol`, the members of a declaration an entry publishes under another name', async () => {
    checkout({
      'packages/lib/src/index.ts': "export { Tree as Forest } from './tree.js';\n",
      'packages/lib/src/tree.ts': 'export interface Tree {\n  has(key: string): boolean;\n}\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'Forest']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^Members:$/m);
    expect(out).toMatch(/has\(key: string\): boolean;/);
  });

  it('answers one binding its file exports under `default` and its own name as one declaration, by the name', async () => {
    checkout({
      'packages/lib/src/greet.ts': 'export function greet(name: string): string {\n  return name;\n}\nexport default greet;\n',
      'packages/lib/src/inner.ts': "import greet from './greet.js';\nexport const inner = greet('lib');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses('greet');
    expect(out).not.toMatch(/another declaration/);
    expect(out.split('\n')[0]).toMatch(/^`greet` \[function\] is imported in 2 places: 1 from another package and 1 inside @acme\/lib\.$/);
    expect(out).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app; used on line 2$/m);
    expect(out).toMatch(/^packages\/lib\/src\/inner\.ts:1 — @acme\/lib; used on line 2$/m);
  });

  it('lists every line one import uses a binding by, under each of its names', async () => {
    checkout({
      'packages/lib/src/greet.ts': 'export function greet(name: string): string {\n  return name;\n}\nexport default greet;\n',
      'packages/lib/src/both.ts': "import greet, { greet as g2 } from './greet.js';\nexport const one = greet('a');\nexport const two = g2('b');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses('greet');
    expect(out.match(/^packages\/lib\/src\/both\.ts:1 /gm)).toEqual(['packages/lib/src/both.ts:1 ']);
    expect(out).toMatch(/^packages\/lib\/src\/both\.ts:1 — @acme\/lib; used on lines 2, 3$/m);
  });

  it('answers, in `ask symbol`, one binding a door publishes as `default` as one declaration, with no local name', async () => {
    checkout({
      'packages/lib/src/index.ts': "export { default as salute } from './greet.js';\n",
      'packages/lib/src/greet.ts': 'export function greet(name: string): string {\n  return name;\n}\nexport default greet;\n',
      'packages/lib/src/inner.ts': "import greet from './greet.js';\nexport const inner = greet('lib');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'symbol', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^salute \[function\]$/m);
    expect(out).not.toMatch(/^default \[function\]$/m);
    expect(out).not.toMatch(/is a local name/);
  });

  it('keys a declaration a door publishes as `default` by the name its file exports it under too', async () => {
    checkout({
      'packages/lib/src/index.ts': "export { default as salute } from './greet.js';\n",
      'packages/lib/src/greet.ts': 'export function greet(name: string): string {\n  return name;\n}\nexport default greet;\n',
      'apps/app/src/hello.ts': "import { salute } from '@acme/lib';\nexport const hello = salute('app');\n",
      'packages/lib/src/inner.ts': "import { greet } from './greet.js';\nexport const inner = greet('lib');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses('greet');
    expect(out).not.toMatch(/another declaration/);
    expect(out.split('\n')[0]).toMatch(/^`greet` \[function\] is imported in 2 places: 1 from another package and 1 inside @acme\/lib, published by @acme\/lib as `salute`/);
  });
});
