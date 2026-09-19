import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Parsed } from '@variance-authority/sense';
import { readModule } from '@variance-authority/sense/read';
import type { Offering } from '@variance-authority/package/help';
import { indexedNames, type IndexedSource } from './indexed-surface.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'indexed-surface-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function parsed(file: string, text: string): Parsed {
  const read = readModule(file, text);
  return { requests: read.requests, exports: read.exports, symbols: read.symbols, harvested: true };
}

describe('published names from indexed declaration facts', () => {
  it('follows a default export of an imported name through a barrel', async () => {
    const files = {
      'entry.ts': "import { Public } from './barrel'; export default Public;",
      'barrel.ts': "export { default as Public } from './value';",
      'value.ts': 'export default function Value() {}\nexport { Value };',
    };
    const sources = new Map<string, IndexedSource>();
    for (const [file, text] of Object.entries(files)) await writeFile(join(root, file), text);
    sources.set('entry.ts', { parsed: parsed('entry.ts', files['entry.ts']), targets: ['barrel.ts'] });
    sources.set('barrel.ts', { parsed: parsed('barrel.ts', files['barrel.ts']), targets: ['value.ts'] });
    sources.set('value.ts', { parsed: parsed('value.ts', files['value.ts']), targets: [] });
    const offering: Offering = {
      name: 'example',
      manifest: 'package.json',
      declared: {},
      entrypoints: [{ subpath: '.', source: 'entry.ts' }],
    };

    const names = await indexedNames(root, [offering], sources, async () => new Map());
    expect([...names('entry.ts').get('default')!.keys()]).toEqual(['function']);
  });

  it('keeps an anonymous default value without inventing a signature', async () => {
    const text = "export default 'example' as const;";
    await writeFile(join(root, 'literal.ts'), text);
    const source = new Map<string, IndexedSource>([
      ['literal.ts', { parsed: parsed('literal.ts', text), targets: [] }],
    ]);
    const offering: Offering = {
      name: 'literal',
      manifest: 'package.json',
      declared: {},
      entrypoints: [{ subpath: '.', source: 'literal.ts' }],
    };

    const names = await indexedNames(root, [offering], source, async () => new Map());
    expect(names('literal.ts').get('default')?.get('const')).toMatchObject({
      kind: 'const',
      at: 'literal.ts',
      line: 1,
    });
  });
});
