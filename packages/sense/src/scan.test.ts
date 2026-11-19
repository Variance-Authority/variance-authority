import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { memoryParseCache, type Parsed } from './cache.js';
import { nativeAvailable } from './addon.js';
import { digestString } from './digest.js';
import { keyFor, parseWay } from './files.js';
import { LARGEST_FILE } from './record.js';
import { scanRelations } from './test-support/scan.js';

/**
 * What the scan declines to open.
 *
 * A parse costs about fifty times the file's bytes in a native arena that
 * `--max-old-space-size` does not bound and `process.memoryUsage()` does not
 * report, so a single generated file is a whole memory budget and the failure it
 * causes in a container is a kill with no JavaScript error attached. The cap is
 * the one place that is decided, and these are the three things it has to get
 * right: decline the file, keep following the graph, and say why.
 */
describe('a file too large to be worth parsing', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-largest-'));
    await write(root, 'src/entry.ts', "export { huge } from './huge.js';\nexport { small } from './small.js';\n");
    await write(root, 'src/small.ts', "export const small = 1;\n");
    // Over the cap by its own exports, not by padding: a barrel is the shape
    // that costs most, because each binding is an object on the JS heap on top
    // of the arena.
    const bindings = Array.from({ length: 4000 }, (_, at) => `export const name${at} = ${at};`);
    await write(root, 'src/huge.ts', bindings.join('\n'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('opens it when it is under the cap', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });
    const huge = records.find((record) => record.file === 'src/huge.ts');

    expect(huge?.unknown).toBeUndefined();
    // A digest is the evidence it was opened: the scan hashes what it read.
    expect(huge?.digest).toMatch(/^v1:/);
  });

  it('declines it when it is over, and says what it was and what the cap was', async () => {
    const records = await scanRelations({ root, dirs: ['src'], largestFile: 1024 });
    const huge = records.find((record) => record.file === 'src/huge.ts');

    expect(huge?.unknown).toMatch(/src\/huge\.ts is \d+ bytes, over the 1024 this scan opens/);
    expect(huge?.edges).toBeUndefined();
    expect(huge).not.toHaveProperty('digest');
  });

  it('is unknown rather than empty, so a declined file is never read as one that imports nothing', async () => {
    const records = await scanRelations({ root, dirs: ['src'], largestFile: 1024 });
    const huge = records.find((record) => record.file === 'src/huge.ts');

    // The distinction the record type exists for. An empty edge list is a file
    // that imports nothing; `unknown` is a file whose edges are unavailable, and
    // a report on the scan has to be able to tell the two apart.
    expect(huge).toHaveProperty('unknown');
    expect(huge).not.toHaveProperty('edges');
  });

  it('keeps walking past it, so one declined file does not cost the rest of the graph', async () => {
    const records = await scanRelations({ root, dirs: ['src'], largestFile: 1024 });
    const files = records.map((record) => record.file);

    // `small.ts` is only in the graph because `entry.ts` names it beside the
    // file that was declined, so its presence is the walk continuing rather than
    // the walk restarting somewhere else.
    expect(files).toContain('src/entry.ts');
    expect(files).toContain('src/small.ts');
    expect(records.find((record) => record.file === 'src/small.ts')?.digest).toMatch(/^v1:/);
    expect(records.find((record) => record.file === 'src/entry.ts')?.edges).toEqual([
      { to: 'src/huge.ts', kind: 'reexports' },
      { to: 'src/small.ts', kind: 'reexports' },
    ]);
  });

  it('caps at a megabyte by default, which is above source people write and below output machines generate', () => {
    expect(LARGEST_FILE).toBe(1024 * 1024);
  });

  it('refuses two competing sources of content identity', async () => {
    await expect(scanRelations({ root, dirs: ['src'], changed: [], digests: false })).rejects.toThrow(
      '`changed` supplies Git identity and cannot be combined with `digests`',
    );
  });
});

/**
 * A digest names a file's bytes before they are opened, and the parse cache
 * names what those bytes said: a file whose parse the cache holds is answered
 * from it, in every language, and never opened again.
 */
describe('a file the parse cache holds', () => {
  it.each([['', {}], [', beside stores that hold none of it', { stores: [] }]] as const)('is answered from the cache without being opened%s', async (_, beside) => {
    const root = await mkdtemp(join(tmpdir(), 'variance-cached-'));
    try {
      const files: Record<string, string> = {
        'pyproject.toml': '[project]\nname = "cached"',
        'src/a.css': "@import './b.css';",
        'src/a.ts': "export { b } from './b';",
        'src/b.css': '.b {}',
        'src/b.ts': 'export const b = 1;',
        'src/pkg/__init__.py': '',
        'src/pkg/a.py': 'import pkg.b',
        'src/pkg/b.py': 'VALUE = 1',
      };
      for (const [path, text] of Object.entries(files)) await write(root, path, text);
      const digests = new Map(Object.entries(files).map(([path, text]) => [path, digestString(`${text}\n`)]));
      const cache = memoryParseCache();
      const edges = async () => {
        const records = await scanRelations({ root, dirs: ['src'], digests, cache, ...beside });
        return Object.fromEntries(['src/a.css', 'src/a.ts', 'src/pkg/a.py'].map((file) => [
          file,
          records.find((record) => record.file === file)?.edges?.map((edge) => edge.to),
        ]));
      };
      const first = await edges();

      // Bytes that ask for nothing, under the digests of the bytes that did: a
      // file opened again would lose its edges. Its size is still looked at.
      for (const [file, text] of [['src/a.css', '/* none */'], ['src/a.ts', '// none'], ['src/pkg/a.py', '# none']]) await write(root, file, text);

      expect(first).toEqual({ 'src/a.css': ['src/b.css'], 'src/a.ts': ['src/b.ts'], 'src/pkg/a.py': ['src/pkg/__init__.py', 'src/pkg/b.py'] });
      expect(await edges()).toEqual(first);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Ten thousand pending modules on a packed tree take the closure graph, held
  // by the addon or handed over file by file: the caller's cache answers there
  // too. A tracked file is read from its blob, so rewriting it shows nothing;
  // the cache instead holds, under `a`'s digest, what `z` beside it says.
  it.runIf(nativeAvailable())('is answered from the cache on the closure graph', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-cached-graph-'));
    try {
      const files: Record<string, string> = {
        'pyproject.toml': '[project]\nname = "cached"',
        'src/a.css': "@import './b.css';", 'src/z.css': "@import './c.css';", 'src/b.css': '.b {}', 'src/c.css': '.c {}',
        'src/a.ts': "export { b } from './b';", 'src/z.ts': "export { c } from './c';", 'src/b.ts': 'export const b = 1;', 'src/c.ts': 'export const c = 1;',
        'src/pkg/__init__.py': '', 'src/pkg/a.py': 'import pkg.b', 'src/pkg/z.py': 'import pkg.c', 'src/pkg/b.py': 'B = 1', 'src/pkg/c.py': 'C = 1',
      };
      for (const [path, text] of Object.entries(files)) await write(root, path, text);
      for (let at = 0; at < 10_000; at += 500) {
        await Promise.all(Array.from({ length: 500 }, (_, each) => write(root, `src/m/m${String(at + each)}.ts`, `export const m = ${String(at + each)};`)));
      }
      const run = promisify(execFile);
      await run('git', ['init', '--quiet'], { cwd: root });
      await run('git', ['add', '.'], { cwd: root });
      await run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'many'], { cwd: root });

      const said = new Map<string, Parsed>();
      const read = await scanRelations({ root, dirs: ['src'], parsed: (file, parse) => said.set(file, parse) });
      const cache = memoryParseCache();
      for (const [a, z] of [['src/a.css', 'src/z.css'], ['src/a.ts', 'src/z.ts'], ['src/pkg/a.py', 'src/pkg/z.py']] as const) {
        cache.set(keyFor(read.find((record) => record.file === a)!.digest!, parseWay(a)), said.get(z)!);
      }
      const edges = (records: readonly { file: string; edges?: readonly { to: string }[] }[]) =>
        Object.fromEntries(['src/a.css', 'src/a.ts', 'src/pkg/a.py'].map((file) => [file, records.find((record) => record.file === file)?.edges?.map((edge) => edge.to)]));
      const expected = { 'src/a.css': ['src/c.css'], 'src/a.ts': ['src/c.ts'], 'src/pkg/a.py': ['src/pkg/__init__.py', 'src/pkg/c.py'] };

      expect(edges(await scanRelations({ root, dirs: ['src'], cache })), 'held by the addon').toEqual(expected);
      expect(edges(await scanRelations({ root, dirs: ['src'], cache, parsed: () => {} })), 'handed over').toEqual(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 240_000);
});

async function write(root: string, path: string, contents: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${contents}\n`, 'utf8');
}
