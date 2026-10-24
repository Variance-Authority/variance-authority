import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` asked about a module rather than a name: a file of the
 * checkout, or a package the checkout resolves. Who imports the module is the
 * question `discover --imports` answers, and `uses` is asked it. A package is
 * asked as a name too, since a specifier like `react` can be one.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-uses-module-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

describe('variance ask uses over a module', () => {
  it('lists the files importing a file named by its path', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'uses', '--name', 'packages/kit/src/money/tax.ts']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out.split('\n')[0]).toBe('`packages/kit/src/money/tax.ts` is a module, not a name: these are the files importing it, as `discover` answers `imports`.');
    expect(out).toMatch(/^apps\/app\/src\/checkout\.ts$/m);
    expect(out).toMatch(/^ {2}apps\/app\/src\/checkout\.ts:1 {2}imports taxOf from @acme\/kit\/src\/money\/tax$/m);
  });

  it('lists the files importing a package, under any of its paths', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'uses', '--name', '@acme/kit']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out.split('\n')[0]).toBe('`@acme/kit` is a package: these are the files importing it, as `discover` answers `imports`.');
    expect(out).toMatch(/^ {2}apps\/app\/src\/checkout\.ts:1 {2}imports taxOf from @acme\/kit\/src\/money\/tax$/m);
  });

  it('answers a file of the checkout as a module, whatever its name holds', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'uses', '--name', 'tsconfig.json']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out.split('\n')[0]).toBe('`tsconfig.json` is a module, not a name: these are the files importing it, as `discover` answers `imports`.');
  });

  it('answers a file named by a relative path as the file it is', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', './packages/kit/src/money/tax.ts']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out.split('\n')[0]).toBe('`./packages/kit/src/money/tax.ts` is a module, not a name: these are the files importing it, as `discover` answers `imports`.');
    expect(out).toMatch(/^ {2}apps\/app\/src\/checkout\.ts:1 {2}imports taxOf from @acme\/kit\/src\/money\/tax$/m);
  });

  it('says a path no file of the checkout is at is no path, rather than counting its importers', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'uses', '--name', './packages/x.ts']);
    expect(code).not.toBe(EXIT_CLEAN);
    expect(out).toBe('');
    expect(err).toContain('`./packages/x.ts` is a path, and no file of the checkout is at it');
    expect(err).not.toContain('importing');
  });

  it('answers a package the checkout resolves as a module, and as the name it also is', async () => {
    checkout({
      'node_modules/react/package.json': JSON.stringify({ name: 'react', main: 'index.js' }),
      'apps/app/src/view.ts': "import { createElement } from 'react';\nexport const view = createElement;\n",
      'packages/lib/src/flag.ts': 'export const react = true;\n',
      'apps/app/src/flagged.ts': "import { react } from '@acme/lib/src/flag';\nexport const flagged = react;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out, err } = await run(['ask', 'uses', '--name', 'react']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out.split('\n')[0]).toBe('`react` is a package: these are the files importing it, as `discover` answers `imports`.');
    expect(out).toMatch(/^ {2}apps\/app\/src\/view\.ts:1 {2}imports createElement from react$/m);
    // The name the checkout also exports is answered after the module.
    expect(out).toMatch(/^`react` \[const\]/m);
    expect(out).toMatch(/^apps\/app\/src\/flagged\.ts:1 — @acme\/app/m);
  });

  it('answers a name no file or package is at as a name', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).not.toContain('is a module');
    expect(out).not.toContain('is a package');
    expect(out).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app/m);
  });
});
