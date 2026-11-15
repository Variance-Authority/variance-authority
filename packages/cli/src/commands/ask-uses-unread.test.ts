import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importersOf } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';

/**
 * `variance ask uses` answers from the relations the index resolved. An
 * import the index resolved to no file resolves to none at question time
 * either, so the answer guesses nothing about where it pointed: no file is
 * named as one that could take the name, and no package as its source.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-uses-unread-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

describe('variance ask uses answers from the resolved relations alone', () => {
  it('lists the resolved uses and names no file whose import the index did not resolve', async () => {
    const root = checkout({
      'packages/lib/src/lost.ts': "import { greet } from './gone.js';\nexport const lost = greet('lost');\n",
      'apps/app/src/alias.ts': "import { greet } from '@/lib/greet';\nexport const alias = greet;\n",
      'apps/app/tsconfig.json': JSON.stringify({ compilerOptions: { paths: { 'internal/*': ['src/internal/*'] } } }),
      'apps/app/src/bare.ts': "import { greet } from 'internal/greet';\nexport const bare = greet;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'greet']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^`greet` \[function\] is imported in 1 place/m);
    expect(out).not.toContain('could not resolve');
    expect(importersOf(root, [[{ file: 'packages/lib/src/greet.ts', name: 'greet' }]])).not.toHaveProperty('unresolved');
  });

  it('names no package outside the workspace for a name no file here declares', async () => {
    checkout({ 'packages/lib/src/parse.ts': "import { parseSync } from 'oxc-parser';\nexport const parsed = parseSync('a.ts', '');\n" });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { out } = await run(['ask', 'uses', '--name', 'parseSync']);
    expect(out).toContain('No file in this workspace declares `parseSync`');
    expect(out).not.toContain('outside this workspace');
    expect(out).not.toContain('discover');
  });
});
