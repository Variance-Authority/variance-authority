import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeSourceTree } from './source-tree-format.js';
import { publishedTreeOf, readTree } from './tree.js';

/**
 * A path question over a large checkout is answered by the addon over the
 * published tree, so the tree JavaScript holds is a handle: no value on it
 * lists the checkout's files, and a walk hands back only what it reached.
 */

const FILES = 64;
let root: string;

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'tree-held-'));
  write('package.json', '{"name":"tree-held-fixture","private":true}\n');
  write('src/entry.ts', "import { m0 } from './many/m0';\nexport const entry = m0;\n");
  for (let n = 0; n < FILES; n++) write(`src/many/m${n}.ts`, `export const m${n} = ${n};\n`);
  execFileSync('git', ['-C', root, 'init', '--quiet']);
  execFileSync('git', ['-C', root, 'add', '.']);
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** How many entries each collection held directly on `value` has. */
function collections(value: object): number[] {
  return Object.values(value).flatMap((held: unknown) =>
    held instanceof Set || held instanceof Map ? [held.size] : Array.isArray(held) ? [held.length] : [],
  );
}

describe('a tree read from a checkout', () => {
  it('holds no JavaScript list of its files', async () => {
    const tree = await readTree({ root });
    expect(collections(tree).filter((size) => size >= FILES)).toEqual([]);
    expect([...tree.reachedFrom(['src/entry.ts'])]).toEqual(['src/entry.ts', 'src/many/m0.ts']);
  }, 120_000);

  it('holds none when it opens the tree a workspace published', () => {
    const records = [{ file: 'src/entry.ts', edges: [{ to: 'src/many/m0.ts', kind: 'imports' as const }] }, ...Array.from({ length: FILES }, (_, n) => ({ file: `src/many/m${n}.ts` }))];
    const tree = publishedTreeOf(encodeSourceTree(records), root, root);
    expect(collections(tree).filter((size) => size >= FILES)).toEqual([]);
    expect([...tree.reaching(['src/many/m0.ts'])]).toEqual(['src/entry.ts', 'src/many/m0.ts']);
  });
});
