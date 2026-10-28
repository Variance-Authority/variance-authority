import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` through a namespace held another way than a named
 * import of it: inside another namespace, as a module's `default`, and on an
 * import written over several lines. Each is a module record, so the name a
 * line reads off it is known without a type.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-namespace-nested-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const NESTED = {
  'packages/lib/src/index.ts': "export * as shout from './greet.js';\nexport * as outer from './inner.js';\n",
  'packages/lib/src/inner.ts': "export * as inner from './greet.js';\n",
  'packages/lib/src/loud.ts': "export * as default from './greet.js';\n",
  'packages/lib/src/spaces.ts': "export * as shout from './greet.js';\n",
  'packages/lib/src/quiet.ts': "export { shout as default } from './spaces.js';\n",
  'packages/lib/src/use-loud.ts': "import loud from './loud.js';\nexport const x = loud.greet('z');\n",
  'packages/lib/src/use-quiet.ts': "import quiet from './quiet.js';\nexport const y = quiet.greet('w');\n",
  'apps/app/src/hello.ts': "import * as lib from '@acme/lib';\nexport const hello = lib.shout.greet('a');\n",
  'apps/app/src/chained.ts': "import { outer } from '@acme/lib';\nexport const deep = outer.inner.greet('b');\n",
  'apps/app/src/multi.ts': "import {\n  shout,\n} from '@acme/lib';\nexport const m = shout.greet('m');\n",
  'apps/app/src/whole.ts': "import * as lib from '@acme/lib';\nexport const all = [lib];\n",
};

async function uses(name: string): Promise<string> {
  const { code, out } = await run(['ask', 'uses', '--name', name, '--limit', '50']);
  expect(code).toBe(EXIT_CLEAN);
  return out;
}

describe('variance ask uses through a namespace held inside another', () => {
  it('lists a name read off a namespace a namespace import holds', async () => {
    checkout(NESTED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await uses('greet')).toMatch(/^apps\/app\/src\/hello\.ts:2 — @acme\/app \(namespace, line 1\)$/m);
  });

  it('lists a name read off a namespace that an `export * as` of a module doing `export * as` holds', async () => {
    checkout(NESTED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await uses('greet')).toMatch(/^apps\/app\/src\/chained\.ts:2 — @acme\/app \(namespace, line 1\)$/m);
  });

  it('no longer says a namespace inside a namespace is not counted', async () => {
    checkout(NESTED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await uses('greet')).not.toContain('a namespace inside a namespace');
  });

  it('lists a name read off a namespace a module passes on as its `default`', async () => {
    checkout(NESTED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const greet = await uses('greet');
    expect(greet).toMatch(/^packages\/lib\/src\/use-loud\.ts:2 — @acme\/lib \(namespace, line 1\)$/m);
    expect(greet).toMatch(/^packages\/lib\/src\/use-quiet\.ts:2 — @acme\/lib \(namespace, line 1\)$/m);
  });

  it('marks a member read with the line its import starts on', async () => {
    checkout(NESTED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await uses('greet')).toMatch(/^apps\/app\/src\/multi\.ts:4 — @acme\/app \(namespace, line 1\)$/m);
  });

  it('lists a namespace import that goes on whole as a place that may read a member of a namespace it holds', async () => {
    checkout(NESTED);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await uses('greet')).toMatch(/^apps\/app\/src\/whole\.ts:2 — @acme\/app \(namespace, line 1, passed on whole: may read it\)$/m);
  });
});
