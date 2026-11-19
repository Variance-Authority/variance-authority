import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openSourceIndex, readSourceRecords } from './source-index.js';
import { scanRelations } from './test-support/scan.js';

/**
 * A directory git cannot list: a tarball, a sandbox, a fixture made in a
 * temporary directory. Its scan reads every file, since nothing names a file's
 * bytes before it is read, and the index it saves keeps a record of each file
 * it parsed beside the parse: what is read off the index — the names, the uses,
 * the code map — reads the records, and an index of parses alone answers none.
 */

const made: string[] = [];

afterEach(async () => {
  await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function unlisted(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sense-unlisted-'));
  made.push(root);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'unlisted' }),
    'src/a.ts': "import { b } from './b';\nexport const a = b;\n",
    'src/b.ts': 'export const b = 1;\n',
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, 'utf8');
  }
  return root;
}

async function scanned(root: string, at: string, digests?: false): Promise<string | undefined> {
  const index = await openSourceIndex(at);
  await scanRelations({ root, dirs: ['src'], cache: index.cache, reuse: index.reuse, ...(digests === false ? { digests } : {}) });
  return index.save();
}

describe('a scan of a directory git cannot list', () => {
  it('keeps a record of each file it parsed in the index it saves', async () => {
    const root = await unlisted();
    const at = join(root, 'cache', 'source-index.bin');

    expect(await scanned(root, at)).toBeUndefined();

    const records = await readSourceRecords(at);
    expect(records.map((record) => record.file)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(records[0]?.edges).toEqual([{ to: 'src/b.ts', kind: 'imports' }]);
  });

  it('writes nothing again over files that did not change', async () => {
    const root = await unlisted();
    const at = join(root, 'cache', 'source-index.bin');
    await scanned(root, at);
    const written = (await openSourceIndex(at)).written;

    await scanned(root, at);

    expect((await openSourceIndex(at)).written).toEqual(written);
  });

  it('keeps none when it was told not to trust digests', async () => {
    const root = await unlisted();
    const at = join(root, 'cache', 'source-index.bin');

    await scanned(root, at, false);

    expect(await readSourceRecords(at)).toEqual([]);
  });
});
