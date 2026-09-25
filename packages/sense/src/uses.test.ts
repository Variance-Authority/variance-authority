import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { EdgeUse, Uses } from '@variance-authority/core/relate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readPublishedSources, updateSourceIndex } from './published.js';

/**
 * The names each file uses of each file it imports, read back from a published
 * index: the records' targets joined to the parses' requests, and nothing new
 * stored.
 *
 * Every use the parse cannot name is whole, so the claims below come in pairs:
 * a name where one was recorded, and no name where one could be wrong.
 */

describe('the uses a published index answers', () => {
  let root: string;
  let uses: Uses;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-uses-'));
    await write('package.json', '{ "name": "fixture" }');
    await write(
      'lib/cart.ts',
      [
        'export interface Cart { readonly items: number }',
        'export const total = 1;',
        'export const label = "cart";',
        'export default function render() { return label; }',
        '',
      ].join('\n'),
    );
    await write('lib/index.ts', "export { total as sum } from './cart.js';\nexport * from './cart.js';\n");
    await write('lib/space.ts', "export * as cart from './cart.js';\n");
    await write('lib/typed.ts', "export type { Cart } from './cart.js';\nexport { label } from './cart.js';\n");
    await write('test/named.test.ts', "import { total } from '../lib/cart.js';\nvoid total;\n");
    await write('test/default.test.ts', "import render, { label } from '../lib/cart.js';\nvoid render, label;\n");
    await write('test/twice.test.ts', "import { total } from '../lib/cart.js';\nimport { label } from '../lib/cart.js';\nvoid total, label;\n");
    await write('test/side.test.ts', "import '../lib/cart.js';\n");
    await write('test/whole.test.ts', "import * as cart from '../lib/cart.js';\nvoid cart;\n");
    await write('test/barrel.test.ts', "import { sum } from '../lib/index.js';\nvoid sum;\n");
    git('init', '--quiet');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');

    const index = join(root, '.index', 'source-index.bin');
    await updateSourceIndex(root, { index });
    uses = (await readPublishedSources(index)).uses;
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(file: string, text: string): Promise<void> {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }

  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: root });
  }

  const sorted = (use: EdgeUse | undefined) => ({ ...use, imports: use?.imports && [...use.imports].sort() });

  it('names what an import binds, the default as `default`, over every import of the same file', () => {
    expect(uses('test/named.test.ts', 'lib/cart.ts')).toEqual({ imports: ['total'] });
    expect(sorted(uses('test/default.test.ts', 'lib/cart.ts'))).toEqual({ imports: ['default', 'label'] });
    expect(sorted(uses('test/twice.test.ts', 'lib/cart.ts'))).toEqual({ imports: ['label', 'total'] });
    expect(uses('test/barrel.test.ts', 'lib/index.ts')).toEqual({ imports: ['sum'] });
  });

  it('names no import for one that binds nothing or binds the namespace, which is the whole module', () => {
    expect(uses('test/side.test.ts', 'lib/cart.ts')).toEqual({});
    expect(uses('test/whole.test.ts', 'lib/cart.ts')).toEqual({});
  });

  it('keeps a star beside a named re-export of the same file, and an `export * as`', () => {
    expect(uses('lib/index.ts', 'lib/cart.ts')).toEqual({ reexports: [['total', 'sum'], ['*', '*']] });
    expect(uses('lib/space.ts', 'lib/cart.ts')).toEqual({ reexports: [['*', 'cart']] });
  });

  it('hands on no name a re-export of types publishes', () => {
    expect(uses('lib/typed.ts', 'lib/cart.ts')).toEqual({ reexports: [['label', 'label']] });
  });

  it('answers nothing for an edge the index does not hold, which a walk reads as whole', () => {
    expect(uses('test/named.test.ts', 'lib/index.ts')).toBeUndefined();
    expect(uses('lib/absent.ts', 'lib/cart.ts')).toBeUndefined();
  });
});
