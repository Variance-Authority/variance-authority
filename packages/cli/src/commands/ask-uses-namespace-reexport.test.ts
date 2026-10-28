import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over a name a module passes on inside a namespace it
 * re-exports with `export * as ns`. The namespace is a module record, so a read
 * of `ns.name` off a binding imported by that name is a read of the module's
 * export, known without a type: the parse records it, and the walk carries the
 * name past the `export * as` that wraps it.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-namespace-reexport-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

const NAMESPACES = {
  'packages/lib/src/index.ts': "export { greet } from './greet.js';\nexport * as shout from './greet.js';\n",
  'apps/app/src/star-as.ts': "import { shout } from '@acme/lib';\nexport const loud = shout.greet('a');\n",
  'apps/app/src/again.ts': "export * as again from '@acme/lib';\n",
  'apps/app/src/through-again.ts': "import { again } from './again.js';\nexport const twice = again.greet('b');\n",
  'apps/app/src/bound.ts': "import { shout } from '@acme/lib';\nconst { greet } = shout;\nexport const bound = greet('c');\n",
  'apps/app/src/passed.ts': "import { shout } from '@acme/lib';\nexport const held = [shout];\n",
};

async function uses(name: string): Promise<string> {
  const { code, out } = await run(['ask', 'uses', '--name', name, '--limit', '50']);
  expect(code).toBe(EXIT_CLEAN);
  return out;
}

describe('variance ask uses through an `export * as` namespace', () => {
  it('lists a member read off a binding a package passes as `export * as`', async () => {
    checkout(NAMESPACES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const greet = await uses('greet');
    expect(greet).toMatch(/^apps\/app\/src\/star-as\.ts:2 — @acme\/app.*\(namespace, line 1\)$/m);
    expect(greet).toMatch(/^apps\/app\/src\/bound\.ts:2 — @acme\/app.*\(namespace, line 1\)$/m);
  });

  it('follows a namespace re-exported a second time under another name', async () => {
    checkout(NAMESPACES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    expect(await uses('greet')).toMatch(/^apps\/app\/src\/through-again\.ts:2 — @acme\/app.*\(namespace, line 1\)$/m);
  });

  it('says an entry that passes the name only inside a namespace publishes it as that namespace\'s member', async () => {
    checkout({
      'packages/lib/src/index.ts': "export * as shout from './greet.js';\n",
      'apps/app/src/hello.ts': "import { shout } from '@acme/lib';\nexport const hello = shout.greet('a');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const greet = await uses('greet');
    expect(greet).toMatch(/^apps\/app\/src\/hello\.ts:2 — @acme\/app.*\(namespace, line 1\)$/m);
    expect(greet).not.toContain('no entry publishes it');
    expect(greet.split('\n')[0]).toContain('published as `shout.greet` by @acme/lib');
  });

  it('follows a namespace a barrel imports and exports by its local name, as `export * as` passes it', async () => {
    checkout({
      'packages/lib/src/bar.ts': "import * as g from './greet.js';\nexport { g };\n",
      'packages/lib/src/use-bar.ts': "import { g } from './bar.js';\nexport const k = g.greet('k');\n",
      'packages/lib/src/star-bar.ts': "import * as bar from './bar.js';\nexport const s = bar.g.greet('s');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const greet = await uses('greet');
    expect(greet).toMatch(/^packages\/lib\/src\/use-bar\.ts:2 — @acme\/lib \(namespace, line 1\)$/m);
    expect(greet).toMatch(/^packages\/lib\/src\/star-bar\.ts:2 — @acme\/lib \(namespace, line 1\)$/m);
    // The barrel passes the namespace on; it reads nothing off it.
    expect(greet).not.toMatch(/^packages\/lib\/src\/bar\.ts/m);
  });

  it('follows a namespace destructured off a namespace import, as a name read off it', async () => {
    checkout({
      'packages/lib/src/index.ts': "export * as shout from './greet.js';\n",
      'apps/app/src/taken.ts': "import * as lib from '@acme/lib';\nconst { shout } = lib;\nexport const t = shout.greet('t');\n",
      'apps/app/src/nested.ts': "import * as lib from '@acme/lib';\nconst { shout: { greet } } = lib;\nexport const n = greet('n');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const greet = await uses('greet');
    expect(greet).toMatch(/^apps\/app\/src\/taken\.ts:3 — @acme\/app.*\(namespace, line 1\)$/m);
    expect(greet).toMatch(/^apps\/app\/src\/nested\.ts:2 — @acme\/app.*\(namespace, line 1\)$/m);
    // The local `greet` the pattern binds is the published one, not a namesake of it.
    expect(greet).not.toContain('[const]');
  });

  it('answers a name a file exports by destructuring it off a module, as the declaration it is', async () => {
    checkout({
      'packages/lib/src/index.ts': "export { greet } from './greet.js';\nexport { pulse } from './carrier.js';\n",
      'packages/lib/src/trace.ts': 'const trace = { pulse: 1 };\nexport default trace;\n',
      'packages/lib/src/carrier.ts': "import trace from './trace.js';\nexport const { pulse } = trace;\n",
      'apps/app/src/beat.ts': "import { pulse } from '@acme/lib';\nexport const beat = pulse;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const pulse = await uses('pulse');
    expect(pulse).toMatch(/^`pulse` \[const\] is imported in 1 place/m);
    expect(pulse).toMatch(/^apps\/app\/src\/beat\.ts:1 — @acme\/app/m);
  });

  it.todo(
    'counts a namespace binding that escapes whole, `[shout]`, as a place that may read each name — needs the walker to record a named holder read whole as a `*` binding member, which the query charges to every name of the namespace it reaches',
  );
});
