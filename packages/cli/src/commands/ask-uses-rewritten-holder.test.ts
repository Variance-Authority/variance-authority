import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';

/**
 * `variance ask discover --imports` and `variance ask uses` over a name read
 * off a variable the file writes again after it holds a module: read off each
 * module a write that may reach the read put there, and off none after a write
 * of something else.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-rewritten-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

const REWRITTEN = {
  'packages/kit/src/a.ts': 'export function foo() {}\nexport function bar() {}\n',
  'packages/kit/src/b.ts': 'export function foo() {}\n',
  'packages/kit/src/reader.ts': "let m = await import('./a.js');\nm.bar();\nm = createStub();\nm.foo();\n",
  'packages/kit/src/maybe.ts': "let m = await import('./a.js');\nif (offline) m = await import('./b.js');\nm.foo();\n",
};

/** The `file:line` of each row `discover --imports <imported>` lists, sorted. */
async function importers(imported: string): Promise<readonly string[]> {
  const { code, out } = await run(['ask', 'discover', '--imports', imported]);
  expect(code).toBe(EXIT_CLEAN);
  const rows: string[] = [];
  let file = '';
  for (const line of out.split('\n')) {
    file = /^(packages\/kit\/\S+)$/.exec(line)?.[1] ?? file;
    const row = /^ {2}(\d+): imports /.exec(line)?.[1];
    if (row !== undefined) rows.push(`${file}:${row}`);
  }
  return rows.sort();
}

describe('a variable written again after it holds a module', () => {
  beforeEach(async () => {
    checkout(REWRITTEN);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
  });

  it('is read off the module before a write of something else, and not after it', async () => {
    expect(await importers('packages/kit/src/a.ts#bar')).toEqual(['packages/kit/src/reader.ts:2']);
    expect(await importers('packages/kit/src/a.ts#foo')).not.toContain('packages/kit/src/reader.ts:4');
  });

  it('is read off each module it may hold, where a write that may not run put a second', async () => {
    expect(await importers('packages/kit/src/a.ts#foo')).toEqual(['packages/kit/src/maybe.ts:3']);
    expect(await importers('packages/kit/src/b.ts#foo')).toEqual(['packages/kit/src/maybe.ts:3']);
  });
});
