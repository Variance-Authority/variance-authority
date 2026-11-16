import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('./record.js', async (original) => ({
  ...await original<typeof import('./record.js')>(),
  recordFor: () => { throw new Error('JavaScript source indexing ran'); },
}));

import { scanCount, scanRelations } from './scan.js';
import { memoryParseCache, type Parsed } from './cache.js';
import { digestString } from './digest.js';
import { keyFor, parseWay } from './files.js';

it('builds a mixed source closure natively while honoring parsed and indexed consumers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sense-native-only-'));
  try {
    for (const [path, source] of [
      ['src/entry.ts', "import '../styles/button.scss';\nexport const entry = 1;\n"],
      ['styles/button.scss', "@use './tokens';\n"],
      ['styles/_tokens.scss', '$color: red;\n'],
    ]) {
      await mkdir(dirname(join(root, path!)), { recursive: true });
      await writeFile(join(root, path!), source!);
    }
    const parsed = vi.fn();
    const indexed = vi.fn();
    const records = await scanRelations({ root, dirs: ['src'], parsed, indexed });
    expect(records.map((record) => record.file)).toEqual(['src/entry.ts', 'styles/_tokens.scss', 'styles/button.scss']);
    expect(records.find((record) => record.file === 'styles/button.scss')?.edges)
      .toEqual([{ to: 'styles/_tokens.scss', kind: 'asset' }]);
    expect(parsed.mock.calls.map(([file]) => file).sort()).toEqual(records.map((record) => record.file));
    expect(indexed.mock.calls.find(([file]) => file === 'styles/button.scss')?.[2])
      .toEqual(['styles/_tokens.scss']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('reuses known content-keyed parses and preserves cached callback objects without a known identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sense-native-cache-'));
  try {
    const source = 'from . import other\n';
    await writeFile(join(root, 'entry.py'), source);
    await writeFile(join(root, 'other.py'), 'value = 1\n');
    const digest = digestString(source);
    const held: Parsed = {
      requests: [{ value: '.other', kind: 'imports', line: 1, bindings: [] }],
      size: { bytes: Buffer.byteLength(source), lines: 1 },
      harvested: true,
    };
    const cache = memoryParseCache();
    cache.set(keyFor(digest, parseWay('entry.py')), held);
    const parsed = vi.fn();
    const known = await scanCount({
      root, dirs: ['.'], cache, parsed,
      digests: new Map([['entry.py', digest], ['other.py', digestString('value = 1\n')]]),
    });
    expect(known).toMatchObject({ files: 2, parsed: 1 });
    expect(parsed.mock.calls.find(([file]) => file === 'entry.py')?.[1]).toBe(held);

    parsed.mockClear();
    const unknown = await scanCount({ root, dirs: ['.'], cache, parsed, digests: false });
    expect(unknown).toMatchObject({ files: 2, parsed: 2 });
    expect(parsed.mock.calls.find(([file]) => file === 'entry.py')?.[1]).toBe(held);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('does not hand a cached parse to consumers when the native read declines it for size', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sense-native-size-'));
  try {
    const source = "import './other';\nexport const entry = 1;\n";
    await writeFile(join(root, 'entry.ts'), source);
    const digest = digestString(source);
    const cache = memoryParseCache();
    cache.set(keyFor(digest, parseWay('entry.ts')), {
      requests: [{ value: './other', kind: 'imports', line: 1, bindings: [] }],
      size: { bytes: Buffer.byteLength(source), lines: 2 },
      harvested: true,
    });
    const parsed = vi.fn();
    const indexed = vi.fn();
    const records = await scanRelations({
      root, dirs: ['.'], digests: new Map([['entry.ts', digest]]), cache,
      largestFile: 1, parsed, indexed,
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.unknown).toContain('over the 1');
    expect(parsed).not.toHaveBeenCalled();
    expect(indexed).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('prepares Rust once across cached frontiers and starts a fresh context for the next scan', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sense-native-rust-frontiers-'));
  try {
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'shared'));
    await writeFile(join(root, 'src/lib.rs'), '#[path = "../shared/child.rs"] mod child;\n');
    await writeFile(join(root, 'shared/child.rs'), 'pub struct Original;\n');
    await writeFile(join(root, 'shared/unused.rs'), 'pub struct Unused;\n');
    const cache = memoryParseCache();
    expect(await scanCount({ root, dirs: ['src'], digests: false, cache }))
      .toMatchObject({ files: 2, parsed: 3 });
    await writeFile(join(root, 'shared/child.rs'), 'pub struct Revised;\n');
    const parsed = vi.fn();
    await scanRelations({ root, dirs: ['src'], digests: false, cache, parsed });
    expect(parsed.mock.calls.find(([file]) => file === 'shared/child.rs')?.[1].symbols)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Revised' })]));
    const digests = new Map([
      ['src/lib.rs', digestString('#[path = "../shared/child.rs"] mod child;\n')],
      ['shared/child.rs', digestString('pub struct Revised;\n')],
      ['shared/unused.rs', digestString('pub struct Unused;\n')],
    ]);
    await scanCount({ root, dirs: ['.'], digests, cache });
    expect(await scanCount({ root, dirs: ['src'], digests, cache }))
      .toMatchObject({ files: 2, parsed: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
