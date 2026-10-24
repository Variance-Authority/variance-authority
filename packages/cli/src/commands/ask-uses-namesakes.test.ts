import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages-fixture.js';

/**
 * `variance ask uses` over a name several files declare. Each declaration is
 * another thing, so the answer names every one of them, and `--file`, the file
 * one declares it in, answers for that declaration alone.
 */

const cwd = process.cwd();

beforeEach(() => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-namesakes-cache-'));
});

afterEach(() => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
});

// `greet` is published from `greet.ts`, exported unpublished from `other.ts`, and kept to itself in `kept.ts`.
const NAMESAKES = {
  'packages/lib/src/other.ts': 'export const greet = 1;\n',
  'packages/lib/src/unrelated.ts': "import { greet } from './other.js';\nexport const unrelated = greet;\n",
  'packages/lib/src/kept.ts': 'function greet(): number {\n  return 2;\n}\nexport const kept = greet();\n',
};

async function uses(...more: readonly string[]): Promise<string> {
  const { code, out, err } = await run(['ask', 'uses', '--name', 'greet', ...more]);
  expect(err).toBe('');
  expect(code).toBe(EXIT_CLEAN);
  return out;
}

describe('variance ask uses over a name several files declare', () => {
  it('names an exported namesake of a published name and how to ask for it alone', async () => {
    checkout(NAMESAKES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses();
    expect(out).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app$/m);
    expect(out).toContain('`greet` is exported, without being published, at packages/lib/src/other.ts:1 as well, which is another declaration.');
    expect(out).toContain('`file`, the file one of them is declared in, answers for that declaration alone.');
  });

  it('answers for the published declaration alone when `--file` names its file', async () => {
    checkout(NAMESAKES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses('--file', 'packages/lib/src/greet.ts');
    expect(out).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app$/m);
    expect(out).not.toMatch(/other\.ts|unrelated\.ts|kept\.ts/);
  });

  it('answers for an exported namesake of a published name when `--file` names its file', async () => {
    checkout(NAMESAKES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses('--file', 'packages/lib/src/other.ts');
    expect(out).toMatch(/^packages\/lib\/src\/unrelated\.ts:1 — @acme\/lib$/m);
    expect(out).not.toMatch(/hello\.ts|kept\.ts/);
  });

  it('answers for a declaration its file keeps when `--file` names that file', async () => {
    checkout(NAMESAKES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses('--file', 'packages/lib/src/kept.ts');
    expect(out).toMatch(/^`greet` \[function\] is declared, not exported, at packages\/lib\/src\/kept\.ts:1/m);
    expect(out).toMatch(/^packages\/lib\/src\/kept\.ts:4 — @acme\/lib$/m);
    expect(out).not.toMatch(/hello\.ts|other\.ts|unrelated\.ts/);
  });

  it('names every declaration when `--file` names a file that declares none', async () => {
    checkout(NAMESAKES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    // A file that declares nothing by the name is found nothing for, which is an answer, not a refusal.
    expect(await uses('--file', 'packages/lib/src/index.ts')).toContain(
      '`greet` is not declared in packages/lib/src/index.ts; it is declared in packages/lib/src/greet.ts, packages/lib/src/kept.ts and packages/lib/src/other.ts.',
    );
  });
});
