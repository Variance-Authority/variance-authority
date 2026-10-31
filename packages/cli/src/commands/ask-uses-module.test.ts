import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` takes a name. A file path or a package specifier is
 * asked as a name like any other, and misses as one: who imports a module is
 * `discover --imports`, and `uses` does not guess which question was meant.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-uses-module-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

describe('variance ask uses over a module name', () => {
  it.each(['packages/kit/src/money/tax.ts', '@acme/kit', 'tsconfig/base.json'])('asks `%s` as a name, misses it as one, and lists no importers of a module', async (name) => {
    checkout();
    await run(['index']);

    const { out, err } = await run(['ask', 'uses', '--name', name]);
    expect(out).toContain(`\`${name}\` is not published by this workspace`);
    expect(out).toContain(`No file in this workspace declares \`${name}\`, at its top level or as a member.`);
    expect(`${out}${err}`).not.toContain('is a module');
    expect(`${out}${err}`).not.toContain('is a package');
    expect(out).not.toMatch(/imports taxOf from @acme\/kit\/src\/money\/tax$/m);
  });

  it('asks `tsconfig.json` as member `json` of `tsconfig`, which is how a name with a dot reads, and lists no importers of a module', async () => {
    checkout();
    await run(['index']);

    const { out, err } = await run(['ask', 'uses', '--name', 'tsconfig.json']);
    expect(out).toContain('No file read here declares `tsconfig` at its top level');
    expect(out).not.toContain('declares `tsconfig.json`');
    expect(`${out}${err}`).not.toContain('is a module');
  });
});
