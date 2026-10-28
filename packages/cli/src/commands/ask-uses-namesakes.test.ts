import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, paragraph, run } from './ask-packages-fixture.js';

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
    expect(out).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app; used on line 2$/m);
    expect(out).toContain('`greet` is exported, without being published, at packages/lib/src/other.ts:1 as well, which is another declaration.');
    expect(out).toMatch(/^`greet` \[function\] is declared, not exported, at packages\/lib\/src\/kept\.ts:1/m);
    expect(out).toContain('`--file`, the file one of them is declared in, answers for that declaration alone.');
  });

  it('lists the imports of an exported namesake apart, as it lists a kept one', async () => {
    checkout(NAMESAKES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses();
    const namesake = paragraph(out, /^`greet` is exported, without being published, at packages\/lib\/src\/other\.ts:1/);
    expect(namesake).toMatch(/^Imported in 1 place, inside @acme\/lib\.$/m);
    expect(out).toMatch(/^packages\/lib\/src\/unrelated\.ts:1 — @acme\/lib; used on line 2$/m);
  });

  it('lists the imports of a published namesake apart, counted as the declaration answered first is', async () => {
    checkout({
      'packages/second/package.json': JSON.stringify({ name: '@acme/second', exports: { '.': './src/index.ts' } }),
      'packages/second/src/index.ts': 'export const greet = 2;\n',
      'apps/app/src/second.ts': "import { greet } from '@acme/second';\nexport const second = greet;\n",
      'apps/app/src/second-whole.ts': "import * as second from '@acme/second';\nexport const modules = [second];\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses();
    expect(out).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app; used on line 2$/m);
    const namesake = paragraph(out, /^`greet` is published by @acme\/second, declared at packages\/second\/src\/index\.ts:1 as well, which is another declaration\.$/m);
    // The module passed on whole may read the name, and is no place that imports it.
    expect(namesake).toMatch(/^Imported in 1 place, from another package\. 1 more passes the module on whole, where this reading does not follow it, and may read `greet`\.$/m);
    // Each declaration's sites follow its own sentence, the first declaration's before any namesake's.
    const [first, second] = out.split(/^`greet` is published by @acme\/second/m);
    expect(first).not.toMatch(/second\.ts|second-whole\.ts/);
    expect(second).toMatch(/^apps\/app\/src\/second\.ts:1 — @acme\/app; used on line 2$/m);
    expect(second).not.toMatch(/hello\.ts/);
  });

  it('names the published declaration it answers first when another shares its name', async () => {
    checkout({
      'packages/second/package.json': JSON.stringify({ name: '@acme/second', exports: { '.': './src/index.ts' } }),
      'packages/second/src/index.ts': 'export const greet = 2;\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const [headline] = (await uses()).split('\n');
    expect(headline).toMatch(/^`greet` \[function\] is imported in 1 place, from another package, published by @acme\/lib, declared at packages\/lib\/src\/greet\.ts:\d+\.$/);
  });

  it('answers a value and a type one file declares under one name as one declaration', async () => {
    checkout({
      'packages/second/package.json': JSON.stringify({ name: '@acme/second', exports: { '.': './src/index.ts' } }),
      'packages/second/src/index.ts': 'export const greet = 2;\nexport type greet = number;\n',
      'apps/app/src/second.ts': "import { greet } from '@acme/second';\nexport const second = greet;\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses();
    expect(out.match(/^`greet` is published by @acme\/second, declared at /gm)).toHaveLength(1);
    expect(out.match(/^apps\/app\/src\/second\.ts:1 /gm)).toHaveLength(1);
  });

  it('answers for the published declaration alone when `--file` names its file', async () => {
    checkout(NAMESAKES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses('--file', 'packages/lib/src/greet.ts');
    expect(out).toMatch(/^apps\/app\/src\/hello\.ts:1 — @acme\/app; used on line 2$/m);
    expect(out).not.toMatch(/other\.ts|unrelated\.ts|kept\.ts/);
  });

  it('answers for an exported namesake of a published name when `--file` names its file', async () => {
    checkout(NAMESAKES);
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const out = await uses('--file', 'packages/lib/src/other.ts');
    expect(out).toMatch(/^packages\/lib\/src\/unrelated\.ts:1 — @acme\/lib; used on line 2$/m);
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
    expect(await uses('--file', 'packages/lib/src/unrelated.ts')).toContain(
      '`greet` is not declared in packages/lib/src/unrelated.ts; it is declared in packages/lib/src/greet.ts, packages/lib/src/kept.ts and packages/lib/src/other.ts.',
    );
  });

  it('answers for the declaration a barrel passes on when `--file` names the barrel', async () => {
    checkout({
      'packages/kit/src/ui/index.ts': "export { Button } from './Button.js';\n",
      'apps/app/src/barreled.ts': "import { Button } from '@acme/kit/src/ui/index';\nexport const barreled = Button('b');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'Button', '--file', 'packages/kit/src/ui/index.ts']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out.split('\n')[0]).toContain('exported at packages/kit/src/ui/Button.ts:1');
    // The import by path of the declaration is a use of it, and so is the one through the barrel.
    expect(out).toMatch(/^apps\/app\/src\/checkout\.ts:2 — @acme\/app, by path from @acme\/kit\/src\/ui\/Button; used on line 3$/m);
    expect(out).toMatch(/^apps\/app\/src\/barreled\.ts:1 — @acme\/app, by path from @acme\/kit\/src\/ui\/index; used on line 2$/m);
  });

  it('answers for the members one file declares when `--file` names it', async () => {
    checkout({
      'packages/kit/src/tree.ts': 'export interface Tree {\n  has(key: string): boolean;\n}\n',
      'packages/kit/src/bag.ts': 'export interface Bag {\n  has(key: string): boolean;\n}\n',
      'apps/app/src/tree-use.ts': "import type { Tree } from '@acme/kit/src/tree';\nexport const inTree = (tree: Tree): boolean => tree.has('a');\n",
      'apps/app/src/bag-use.ts': "import type { Bag } from '@acme/kit/src/bag';\nexport const inBag = (bag: Bag): boolean => bag.has('a');\n",
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const { code, out } = await run(['ask', 'uses', '--name', 'has', '--file', 'packages/kit/src/tree.ts']);
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toMatch(/^packages\/kit\/src\/tree\.ts:2 — Tree$/m);
    expect(out).toMatch(/^apps\/app\/src\/tree-use\.ts:2 — @acme\/app, read$/m);
    expect(out).not.toMatch(/bag/);
  });
});
