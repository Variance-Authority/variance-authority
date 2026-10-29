import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over a name a module hands out as a key of the object
 * its `export =` or `module.exports =` assigns, and over a module a file
 * holds through a type. CommonJS is read on a best-effort basis: the object's
 * static keys are the module's exports, and a read off a default import of it
 * is a read through `default`, which may be the key. A type query
 * `typeof m.name` off a holder, a type-only import among them, reads `name`;
 * `typeof import('m')` reads no name until a value it types is read, and the
 * reader does not establish what a call returns; and naming the object in `export =`
 * passes its keys on, which is no use of them.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-module-objects-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const OBJECTS = {
  'packages/kit/src/preconditions.cts':
    '/** Record one call. */\nfunction recorder(value: number): number {\n  return value;\n}\n\nfunction scoped(): number {\n  return recorder(1);\n}\n\nexport = { recorder, scoped };\n',
  'packages/kit/src/runner.ts': "import preconditions from './preconditions.cjs';\nexport const ran = preconditions.scoped();\n",
  'packages/kit/src/typed.test.ts':
    "import { createRequire } from 'node:module';\nconst preconditions = createRequire(import.meta.url)('./preconditions.cjs') as typeof import('./preconditions.cjs');\ntype Scoped = ReturnType<typeof preconditions.scoped>;\nexport const probe: Scoped = preconditions.scoped();\n",
  'packages/kit/src/direct.ts':
    "declare function load(): unknown;\nexport const run = (load() as typeof import('./preconditions.cjs')).scoped();\n",
  'packages/kit/src/legacy.cjs': 'function hush() {\n  return 0;\n}\n\nmodule.exports = { hush, quiet: hush };\n',
  'apps/app/src/listen.ts': "import preconditions from '@acme/kit/src/preconditions.cjs';\nexport const heard = preconditions.recorder(2);\n",
  'apps/app/src/scoped-type.ts':
    "import type preconditions from '@acme/kit/src/preconditions.cjs';\nexport type Scoped = ReturnType<typeof preconditions.scoped>;\n",
  'apps/app/src/quiet.ts': "import legacy from '@acme/kit/src/legacy.cjs';\nexport const hushed = legacy.quiet();\n",
  'packages/lib/src/index.ts': "export { greet } from './greet.js';\nexport { split } from './split.js';\n",
  'packages/lib/src/split.ts': "export function split(text: string): string[] {\n  return text.split(',');\n}\n",
  'apps/app/src/splitter.ts': "import { split } from '@acme/lib';\nexport const parts = split('a,b');\n",
  'apps/app/src/split-type.ts': "import type * as lib from '@acme/lib';\nexport type Parts = ReturnType<typeof lib.split>;\n",
  'apps/app/src/typed.ts': "type Lib = typeof import('@acme/lib');\nexport const use = (lib: Lib) => lib.greet('x');\n",
  'apps/app/src/mocked.test.ts':
    "import { vi } from 'vitest';\nvi.mock('@acme/lib', async (original) => ({ ...(await original<typeof import('@acme/lib')>()) }));\n",
};

async function uses(name: string): Promise<string> {
  const { code, out } = await run(['ask', 'uses', '--name', name]);
  expect(code).toBe(EXIT_CLEAN);
  return out;
}

describe('variance ask uses over a module object', () => {
  it('lists a call off the default import of an `export =` object as a read through `default`', async () => {
    checkout(OBJECTS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const recorder = await uses('recorder');
    expect(recorder).toMatch(/^apps\/app\/src\/listen\.ts:2 — @acme\/app.* \(namespace, line 1, through `default`: may read it\)$/m);
    const scoped = await uses('scoped');
    expect(scoped).toMatch(/^packages\/kit\/src\/runner\.ts:2 — @acme\/kit \(namespace, line 1, through `default`: may read it\)$/m);
  });

  it('lists a type query off a type-only default import of an `export =` object as a read through `default`', async () => {
    checkout(OBJECTS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await uses('scoped')).toMatch(/^apps\/app\/src\/scoped-type\.ts:2 — @acme\/app.*through `default`: may read it\)$/m);
  });

  it('reads a key of a `module.exports` object under the name the key gives it', async () => {
    checkout(OBJECTS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await uses('quiet')).toMatch(/^apps\/app\/src\/quiet\.ts:2 — @acme\/app.* \(namespace, line 1, through `default`: may read it\)$/m);
  });

  it('lists a type query off a type-only namespace import as a type use', async () => {
    checkout(OBJECTS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await uses('split')).toMatch(/^apps\/app\/src\/split-type\.ts:2 — @acme\/app.*type only/m);
  });

  it('does not count naming a declaration in `export =` as a use of it', async () => {
    checkout(OBJECTS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const recorder = await uses('recorder');
    expect(recorder).toMatch(/^packages\/kit\/src\/preconditions\.cts:7 — @acme\/kit$/m);
    expect(recorder).not.toMatch(/preconditions\.cts:10 /);
    expect(await uses('scoped')).not.toMatch(/preconditions\.cts:10 /);
  });

  it('reads a type query and a call off a value cast to `typeof import()`', async () => {
    checkout(OBJECTS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const scoped = await uses('scoped');
    expect(scoped).toMatch(/^packages\/kit\/src\/typed\.test\.ts:3 — @acme\/kit \(type only\) \(import\(\) on line 2\)$/m);
    expect(scoped).toMatch(/^packages\/kit\/src\/typed\.test\.ts:4 — @acme\/kit \(type only\) \(import\(\) on line 2\)$/m);
  });

  it('reads a call off a cast to `typeof import()` written in place, with no variable', async () => {
    checkout(OBJECTS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await uses('scoped')).toMatch(/^packages\/kit\/src\/direct\.ts:2 — @acme\/kit \(type only\) \(import\(\) on line 2\)$/m);
  });

  it('reads a member off a parameter a `typeof import()` alias types', async () => {
    checkout(OBJECTS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await uses('greet')).toMatch(/^apps\/app\/src\/typed\.ts:2 — @acme\/app \(type only\) \(import\(\) on line 1\)$/m);
  });

  it('lists no file for a `typeof import()` that types no value read by name, nor for a call it is a type argument of', async () => {
    checkout(OBJECTS);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const split = await uses('split');
    expect(split).toMatch(/^apps\/app\/src\/splitter\.ts:1 — @acme\/app; used on line 2$/m);
    expect(split).not.toContain('typed.ts');
    expect(split).not.toContain('mocked.test.ts');
    expect(split).not.toContain('may read it');
  });
});
