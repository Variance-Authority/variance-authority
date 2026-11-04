import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, paragraph, run } from './ask-packages.fixture.js';

/**
 * `variance ask uses` over a name several files declare. Each declaration is
 * another thing, so the answer names every one of them, and `--file`, the file
 * one declares it in, answers for that declaration alone.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-namesakes-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
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

// `Reach` is published by `@acme/a`, and exported by a file of `@acme/h` that its entry does not open.
const REACH = {
  'packages/a/package.json': JSON.stringify({ name: '@acme/a', type: 'module', exports: { '.': './src/index.ts' } }),
  'packages/a/src/index.ts': '/** How far a signal travels, in metres. */\nexport interface Reach { readonly metres: number; }\n',
  'packages/h/package.json': JSON.stringify({ name: '@acme/h', type: 'module', exports: { '.': './src/index.ts' }, dependencies: { '@acme/a': '*' } }),
  'packages/h/src/reach.ts': '/** How many hops a message may still take. */\nexport type Reach = number;\n',
  'packages/h/src/index.ts':
    "import type { Reach as Far } from '@acme/a';\nimport type { Reach } from './reach.js';\nexport const hops: Reach = 3;\nexport const far: Far = { metres: 1 };\n",
};

/** `variance ask uses --name Reach` straight after each of three `variance index` runs, its generation's stamp cut. */
async function afterEachIndex(): Promise<readonly string[]> {
  const answers: string[] = [];
  for (let runs = 0; runs < 3; runs += 1) {
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const { code, out, err } = await run(['ask', 'uses', '--name', 'Reach']);
    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    answers.push(out.replace(/^Snapshot .*$/m, ''));
  }
  return answers;
}

describe('variance ask uses after `variance index` ran again', () => {
  it('names an exported namesake of a published name each time', async () => {
    checkout(REACH);

    const [first, second, third] = await afterEachIndex();
    expect(first).toContain('`Reach` is exported, without being published, at packages/h/src/reach.ts:2 as well, which is another declaration.');
    expect(first).toMatch(/^packages\/h\/src\/index\.ts:2 — @acme\/h \(type only\); used on line 3$/m);
    expect(first).toContain('`--file`, the file one of them is declared in, answers for that declaration alone.');
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('names a namesake published only inside `export * as ns` each time', async () => {
    checkout({ ...REACH, 'packages/h/src/index.ts': "export * as ns from './reach.js';\n" });

    const [first, second, third] = await afterEachIndex();
    expect(first).toContain('packages/h/src/reach.ts:2');
    expect(first).toContain('`--file`, the file one of them is declared in, answers for that declaration alone.');
    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});

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

  it('names every other declaration by file and line under its headline, before any site', async () => {
    checkout({
      ...NAMESAKES,
      'packages/second/package.json': JSON.stringify({ name: '@acme/second', exports: { '.': './src/index.ts' } }),
      'packages/second/src/index.ts': 'export const greet = 2;\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const [headline, ...rest] = (await uses()).split('\n');
    expect(headline).toMatch(/^`greet` \[function\] is imported in 1 place, .*packages\/lib\/src\/greet\.ts:\d+\.$/);
    expect(rest.slice(0, 4)).toEqual([
      'It is declared 3 more times, each another thing, answered below:',
      '  packages/second/src/index.ts:1, published by @acme/second',
      '  packages/lib/src/other.ts:1, exported without being published',
      '  packages/lib/src/kept.ts:1, not exported',
    ]);
  });

  it('names a member by the name with the other declarations under its headline', async () => {
    checkout({ 'packages/lib/src/shape.ts': 'export interface Shape {\n  greet(): void;\n}\n' });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const [, ...rest] = (await uses()).split('\n');
    expect(rest.slice(0, 2)).toEqual(['It is declared once more, as another thing, answered below:', '  packages/lib/src/shape.ts:2, a member of `Shape`']);
  });

  it('keeps the headline of a name one file declares', async () => {
    checkout({});
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const [headline, next] = (await uses()).split('\n');
    expect(headline).toMatch(/^`greet` \[function\] is imported in 1 place, from another package\.$/);
    expect(next).toMatch(/^Path order; /);
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

  it('names the published declaration it answers first when a kept one shares its name', async () => {
    checkout({ 'packages/lib/src/kept.ts': NAMESAKES['packages/lib/src/kept.ts'] });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const [headline] = (await uses()).split('\n');
    expect(headline).toMatch(/^`greet` \[function\] is imported in 1 place, from another package, published by @acme\/lib, declared at packages\/lib\/src\/greet\.ts:\d+\.$/);
  });

  it('names the published declaration nothing imports when another shares its name', async () => {
    checkout({
      'apps/app/src/hello.ts': 'export const hello = 1;\n',
      'packages/second/package.json': JSON.stringify({ name: '@acme/second', exports: { '.': './src/index.ts' } }),
      'packages/second/src/index.ts': 'export const greet = 2;\n',
    });
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);

    const [headline, ...rest] = (await uses()).split('\n');
    expect(headline).toMatch(/^`greet` \[function\] is published by @acme\/lib, declared at packages\/lib\/src\/greet\.ts:\d+, and nothing in this workspace imports it; /);
    expect(rest.slice(0, 2)).toEqual(['It is declared once more, as another thing, answered below:', '  packages/second/src/index.ts:1, published by @acme/second']);
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
    expect(out).not.toContain('It is declared');
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
