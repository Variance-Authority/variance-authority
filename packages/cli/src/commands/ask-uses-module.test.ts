import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` asked about a module rather than a name: a file path or
 * a package. No name holds a `/`, so the question is who imports the module,
 * which `discover --imports` answers, and `uses` answers it the same way.
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
    expect(out.split('\n')[0]).toBe('`@acme/kit` is a module, not a name: these are the files importing it, as `discover` answers `imports`.');
    expect(out).toMatch(/^ {2}apps\/app\/src\/checkout\.ts:1 {2}imports taxOf from @acme\/kit\/src\/money\/tax$/m);
  });
});
