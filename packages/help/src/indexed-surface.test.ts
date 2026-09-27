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

/** Each name `entry` publishes, as `<kind> <file>:<line>` for every kind it reads as. */
async function publishedBy(
  entry: string,
  files: Record<string, { readonly text: string; readonly targets: readonly string[] }>,
): Promise<Record<string, string[]>> {
  const sources = new Map<string, IndexedSource>();
  for (const [file, { text, targets }] of Object.entries(files)) {
    await writeFile(join(root, file), text);
    sources.set(file, { parsed: parsed(file, text), targets });
  }
  const offering: Offering = {
    name: entry,
    manifest: 'package.json',
    declared: {},
    entrypoints: [{ subpath: '.', source: entry }],
  };
  const names = await indexedNames(root, [offering], sources, async () => new Map());
  return Object.fromEntries(
    [...names(entry)].map(([name, kinds]) => [
      name,
      [...kinds.values()].map((declared) => `${declared.kind} ${declared.at}:${declared.line}`),
    ]),
  );
}

const logger = { text: 'export default function logger(message: string): void {}\n', targets: [] };

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

  it('follows `export default name` to its import by the name Sense read, whatever is written around it', async () => {
    const commented = "import OriginalLogger from './logger';\nexport default /* the shared one */ OriginalLogger;\n";

    expect(await publishedBy('commented.ts', {
      'commented.ts': { text: commented, targets: ['logger.ts'] },
      'logger.ts': logger,
    })).toEqual({ default: ['function logger.ts:1'] });
  });

  it('reads a const initialised from an import as the const, the way declaration emit publishes it', async () => {
    // `tsc --declaration` writes this pair as `export default OriginalLogger`
    // and `export declare const logger: typeof OriginalLogger`: the default is
    // the import, and `logger` is a declaration of its own in this file.
    const pair = "import OriginalLogger from './logger';\nexport default OriginalLogger;\nexport const logger = OriginalLogger;\n";

    expect(await publishedBy('pair.ts', {
      'pair.ts': { text: pair, targets: ['logger.ts'] },
      'logger.ts': logger,
    })).toEqual({ default: ['function logger.ts:1'], logger: ['const pair.ts:3'] });
  });
});
