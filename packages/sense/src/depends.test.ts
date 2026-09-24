import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { affectedBy, relationsOfFiles } from '@variance-authority/core/relate';
import { directive } from './depends.js';
import { readModule } from './read.js';
import { scanRelations } from './scan.js';

/**
 * `/// <depends path>`: the edge a module's author draws to a file it reads
 * without importing it. `native-read.test.ts` holds the two readers to the same
 * answer over the repository, fixtures included.
 */

describe('a `/// <depends>` directive', () => {
  it('names a path relative to the file that declares it', () => {
    expect(directive('/ <depends path="./schema.graphql" />')).toBe('./schema.graphql');
    expect(directive("/<depends path='data/rows.json'/>")).toBe('./data/rows.json');
    expect(directive('/ <depends  path = "../shared.json" />')).toBe('../shared.json');
  });

  it('is reported when it names nothing, never dropped', () => {
    expect(directive('/ <depends />')).toBeNull();
    expect(directive('/ <depends filepath="x.json" />')).toBeNull();
    expect(directive('/ <depends path="" />')).toBeNull();

    const read = readModule('a.ts', '/// <depends />\nexport const a = 1;');
    expect(read.requests).toEqual([]);
    expect(read.unknown).toBe('1 `/// <depends>` directive(s) that name no `path`');
  });

  it('is a comment when it is anything else', () => {
    expect(directive(' <depends path="x.json" />')).toBeUndefined();
    expect(directive('/ <reference path="x.d.ts" />')).toBeUndefined();
    expect(directive('/ <dependson path="x.json" />')).toBeUndefined();
    expect(readModule('a.ts', '/* /// <depends path="x.json" /> */').requests).toEqual([]);
  });
});

describe('a file a module declares it reads', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'va-depends-'));
    await write(root, 'src/schema.graphql', 'type Query { rows: [Int!]! }');
    await write(root, 'src/rows.json', '[1, 2, 3]');
    await write(
      root,
      'src/server.ts',
      [
        '/// <depends path="./schema.graphql" />',
        "import { readFileSync } from 'node:fs';",
        "export const schema = readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8');",
      ].join('\n'),
    );
    // The same read with no directive: the graph has no way to see it.
    await write(
      root,
      'src/rows.ts',
      "import { readFileSync } from 'node:fs';\nexport const rows = readFileSync(new URL('./rows.json', import.meta.url), 'utf8');",
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('is an edge of its own kind, and a change to it reaches the module', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });
    const server = records.find((record) => record.file === 'src/server.ts');

    expect(server?.edges).toEqual([{ to: 'src/schema.graphql', kind: 'depends' }]);
    expect(server?.unknown).toBeUndefined();

    const relations = relationsOfFiles(records);
    expect(affectedBy(relations, ['src/schema.graphql']).files).toContain('src/server.ts');
    expect(affectedBy(relations, ['src/rows.json']).files).not.toContain('src/rows.ts');
  });
});

it.todo(
  'a `/// <depends path>` holding a glob draws an edge to every tracked file it matches — needs multi-target resolution on the native scan and a reuse witness over the glob’s base directory',
);

async function write(root: string, path: string, contents: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${contents}\n`, 'utf8');
}
