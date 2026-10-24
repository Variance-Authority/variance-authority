import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * What `variance ask uses` tells you to ask next is spelled the way this
 * command takes it: a flag as `--from`, another question as `variance ask
 * symbol`. The same answer over MCP names `from` and `docs_symbol`, which a
 * shell does not take.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-uses-spelling-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

describe('variance ask uses, said as a shell asks', () => {
  it('names the flags and the questions this command takes', async () => {
    checkout({ 'apps/app/src/again.ts': "import { greet } from '@acme/lib';\nexport const again = greet('again');\n" });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'greet', '--limit', '1']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('Path order; `--from` sorts nearest first.');
    expect(out).toContain('… 1 more not shown; a higher `--limit` shows them.');
    expect(out).not.toMatch(/`(from|limit)`/u);
  });

  it('names `variance ask symbol` for a name nothing imports', async () => {
    checkout({ 'apps/app/src/hello.ts': 'export const hello = 1;\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(out).toContain('`variance ask symbol` has its signature and what is written above it.');
    expect(out).not.toContain('docs_');
  });

  it('names `variance ask search` for a name nothing publishes', async () => {
    checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'uses', '--name', 'gree']);
    expect(out).toContain('ask `variance ask search` with it as the `--query`.');
  });
});
