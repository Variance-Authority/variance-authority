import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { affectedBy, relationsOfFiles } from '@variance-authority/core/relate';
import { readModule } from './read.js';
import { scanRelations } from './scan.js';

/**
 * `/// <depends path>`: the edge a module's author draws to a file it reads
 * without importing it, read by `native/src/depends.rs`.
 */

/** The paths a module's `/// <depends>` directives name, as the reader reads them. */
function named(line: string): readonly string[] {
  return readModule('a.ts', `${line}\nexport const a = 1;`)
    .requests.filter((request) => request.kind === 'depends')
    .map((request) => request.value);
}

describe('a `/// <depends>` directive', () => {
  it('names a path relative to the file that declares it', () => {
    expect(named('/// <depends path="./schema.graphql" />')).toEqual(['./schema.graphql']);
    expect(named("///<depends path='data/rows.json'/>")).toEqual(['./data/rows.json']);
    expect(named('/// <depends  path = "../shared.json" />')).toEqual(['../shared.json']);
  });

  it('is reported when it names nothing, never dropped', () => {
    for (const line of ['/// <depends />', '/// <depends filepath="x.json" />', '/// <depends path="" />']) {
      const read = readModule('a.ts', `${line}\nexport const a = 1;`);
      expect(read.requests).toEqual([]);
      expect(read.unknown).toBe('1 `/// <depends>` directive(s) that name no `path`');
    }
  });

  it('is a comment when it is anything else', () => {
    expect(named('// <depends path="x.json" />')).toEqual([]);
    expect(named('/// <reference path="x.d.ts" />')).toEqual([]);
    expect(named('/// <dependson path="x.json" />')).toEqual([]);
    expect(named('/* /// <depends path="x.json" /> */')).toEqual([]);
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
