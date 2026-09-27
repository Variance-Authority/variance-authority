import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { relationsOfFiles, type FileRecord } from '@variance-authority/core/relate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nativeAvailable } from './native.js';
import { realPath } from './resolve.js';
import { scanRelations } from './scan.js';
import { taintRecords, taintTable } from './taint/index.js';
import { declaredEffects } from './test-selection/effects.js';
import { gitDigests } from './tree.js';

/**
 * A `build/` directory Git tracks is source, and an import into it lands.
 *
 * Docusaurus keeps its `build` command in `src/commands/build/`, next to the
 * command that imports it. The scan reads that file because Git lists it, so a
 * resolver that declined the directory by name alone left the import pointing
 * at a file the graph holds and never reached. The same name on disk and
 * nowhere in Git's listing stays declined, and so does a tracked `dist/`,
 * whose meaning belongs to the configuration that emits it.
 *
 * Every route a scan can take resolves the same way: the addon's own tree, a
 * batch reading from the working tree, a tree built from `changed` or from
 * digests the caller supplies, and the taint join over the records any of them
 * produced. So does the reading of a diff, which resolves an import the change
 * added to ask what loading it does, and walks the graph from where it lands.
 */

const FILES: Readonly<Record<string, string>> = {
  '.gitignore': 'src/commands/build/ignored.ts\n',
  'package.json': JSON.stringify({ name: 'fixture', sideEffects: ['./src/commands/build/effect.ts'] }),
  'src/commands/build/a.ts': "import './effect';\nexport const a = 1;\n",
  'src/commands/build/effect.ts': 'globalThis.ready = true;\n',
  'src/commands/b.ts': "import { a } from './build/a';\nexport const b = a;\n",
  'src/commands/dist/c.ts': 'export const c = 1;\n',
  'src/commands/other.ts':
    "import { c } from './dist/c';\nimport { ignored } from './build/ignored';\nexport const other = [c, ignored];\n",
  'src/commands/build/ignored.ts': 'export const ignored = 1;\n',
  'src/c.scss': "@use './build/d';\n",
  'src/build/_d.scss': 'a { color: red; }\n',
};

describe.runIf(nativeAvailable())('an import into a tracked build directory', () => {
  let root: string;

  beforeAll(() => {
    root = realPath(mkdtempSync(join(tmpdir(), 'sense-tracked-build-')));
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    git('init', '--quiet');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'source');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  }

  const record = (records: readonly FileRecord[], file: string): FileRecord | undefined =>
    records.find((each) => each.file === file);
  const targets = (records: readonly FileRecord[], file: string): readonly string[] =>
    (record(records, file)?.edges ?? []).map((edge) => edge.to);

  it('lands on the file Git lists, from a module and from a stylesheet', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });

    expect(targets(records, 'src/commands/b.ts')).toEqual(['src/commands/build/a.ts']);
    expect(record(records, 'src/commands/b.ts')?.unresolved).toBeUndefined();
    expect(targets(records, 'src/c.scss')).toEqual(['src/build/_d.scss']);
    expect(record(records, 'src/commands/build/a.ts')).toBeDefined();
  });

  it('declines a build file Git does not list and a tracked dist file', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });

    expect(targets(records, 'src/commands/other.ts')).toEqual([]);
    expect(record(records, 'src/commands/other.ts')?.unresolved).toEqual(
      expect.arrayContaining(['./dist/c', './build/ignored']),
    );
    expect(record(records, 'src/commands/build/ignored.ts')).toBeUndefined();
    expect(record(records, 'src/commands/dist/c.ts')).toBeUndefined();
  });

  it('resolves the same on every route a scan takes', async () => {
    const packed = await scanRelations({ root, dirs: ['src'] });

    expect(await scanRelations({ root, dirs: ['src'], packs: false })).toEqual(packed);
    expect(await scanRelations({ root, dirs: ['src'], changed: [] })).toEqual(packed);
    expect(await scanRelations({ root, dirs: ['src'], digests: (await gitDigests(root))! })).toEqual(packed);
  });

  it('declines the directory when only the disk says what is in it', async () => {
    const records = await scanRelations({ root, dirs: ['src'], digests: false });

    expect(targets(records, 'src/commands/b.ts')).toEqual([]);
    expect(record(records, 'src/commands/build/a.ts')).toBeUndefined();
  });

  it('joins a taint addition into it, on the word the records carry', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });
    const taint = taintTable('hand', { 'src/commands/other.ts': { '+': ['./build/a'] } });
    const tainted = await taintRecords(records, [taint], { root });

    expect(tainted.additions.get('src/commands/other.ts')).toEqual(['src/commands/build/a.ts']);
    expect(tainted.records).toHaveLength(records.length);
  });

  it('walks the graph from an added import of it, to what its package declares loading does', async () => {
    const relations = relationsOfFiles(await scanRelations({ root, dirs: ['src'] }));

    expect(declaredEffects(root, relations, 'src/commands/other.ts', ['./build/a'])).toEqual([
      'src/commands/build/effect.ts',
    ]);
  });
});
