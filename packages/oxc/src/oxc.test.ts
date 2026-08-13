import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { movedBy, relationsOfFiles } from '@variance-authority/core';
import { readModule, readStyle } from './read.js';
import { scanRelations } from './scan.js';

/**
 * Two halves, and only one of them fails loudly.
 *
 * A reader that misses an edge still returns a list, a scan that misses a file
 * still returns records, and the selector built on them still returns subjects —
 * fewer of them, with no error anywhere. So the cases with the most weight here
 * are the ones about files that could not be read: `unknown` is the difference
 * between a saving and a silent hole.
 */

describe('reading a module', () => {
  it('separates a type import from a value one', () => {
    const read = readModule(
      'a.tsx',
      "import type { A } from './types';\nimport { B } from './b';\nimport C, { type D } from './cd';\n",
    );

    expect(read.specifiers).toEqual([
      { value: './types', kind: 'type' },
      { value: './b', kind: 'imports' },
      // One type binding among values is a value import: `C` survives compilation.
      { value: './cd', kind: 'imports' },
    ]);
    expect(read.unknown).toBeUndefined();
  });

  it('reads a side-effect import, which is how a stylesheet arrives', () => {
    expect(readModule('a.tsx', "import './button.css';\n").specifiers).toEqual([
      { value: './button.css', kind: 'imports' },
    ]);
  });

  it('reads every re-export, including the star', () => {
    const read = readModule(
      'index.ts',
      "export * from './star';\nexport { E } from './e';\nexport type { F } from './f';\n",
    );

    expect(read.specifiers).toEqual([
      { value: './star', kind: 'reexports' },
      { value: './e', kind: 'reexports' },
      { value: './f', kind: 'type' },
    ]);
  });

  it('reads a literal dynamic import and refuses a computed one', () => {
    const read = readModule(
      'a.ts',
      'const x = import("./dyn");\nconst y = import(`./page/${name}`);\n',
    );

    expect(read.specifiers).toEqual([{ value: './dyn', kind: 'dynamic' }]);
    // The template is quoted and still not a constant, which is exactly the
    // shape that must widen rather than resolve to a directory.
    expect(read.unknown).toContain('not a literal');
  });

  it('reads a literal require and widens on one it cannot read', () => {
    const literal = readModule('a.cjs', "const a = require('./req');\n");
    expect(literal.specifiers).toEqual([{ value: './req', kind: 'imports' }]);
    expect(literal.unknown).toBeUndefined();

    const computed = readModule('b.cjs', "const b = require(name);\n");
    expect(computed.unknown).toContain('require()');
  });

  it('says so when the parse did not finish', () => {
    // `oxc` recovers, so a broken file still yields a module record. Treating
    // that partial record as the whole truth is the failure being refused.
    const read = readModule('broken.ts', "import { A } from './a';\nfunction (((\n");

    expect(read.unknown).toContain('parse error');
  });
});

describe('reading a stylesheet', () => {
  it('finds every shape a stylesheet names a file in', () => {
    const read = readStyle(
      'button.css',
      [
        "@import './tokens.css';",
        '@use "sass:math";',
        "@forward './mixins';",
        '.b { background: url(./texture.png); }',
        '.c { background: url("https://cdn.example/x.png"); }',
        ".d { composes: base from './base.module.css'; }",
      ].join('\n'),
    );

    expect(read.specifiers.map((specifier) => specifier.value)).toEqual([
      './tokens.css',
      'sass:math',
      './mixins',
      './texture.png',
      './base.module.css',
    ]);
    expect(read.specifiers.every((specifier) => specifier.kind === 'asset')).toBe(true);
  });
});

describe('scanning a tree', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-oxc-'));

    await write(root, 'package.json', '{ "name": "fixture", "type": "module" }');
    await write(root, 'design/tokens.css', ':root { --accent: rebeccapurple; }');
    await write(root, 'design/button.css', "@import './tokens.css';\n.b { color: var(--accent); }");
    await write(
      root,
      'src/Button.tsx',
      [
        "import '../design/button.css';",
        "import { clamp } from './util';",
        "import type { Theme } from './theme';",
        'export function Button() { return null; }',
      ].join('\n'),
    );
    await write(root, 'src/util.ts', 'export const clamp = (n: number) => n;');
    await write(root, 'src/theme.ts', 'export type Theme = "light" | "dark";');
    // Written the way `nodenext` requires: the specifier says `.js`, the file on
    // disk is `.ts`.
    await write(root, 'src/Clock.tsx', "import { clamp } from './util.js';\nexport const Clock = () => null;");
    await write(root, 'src/legacy.js', 'const mod = require(process.env.WHICH);\nmodule.exports = mod;');
    await write(root, 'src/Legacy.tsx', "import './legacy.js';\nexport function Legacy() { return null; }");
    await write(root, 'src/vendor.ts', "import { readFile } from 'node:fs/promises';\nimport React from 'react';\nexport { readFile, React };");
    await write(root, 'dist/Button.js', 'export function Button() { return null; }');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('follows a stylesheet out of the directories it was pointed at', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });
    const files = records.map((record) => record.file);

    // `design/` is not a configured root. It is in the answer because a file
    // under `src/` imports into it, which is the only reason this scan follows
    // rather than lists.
    expect(files).toContain('design/button.css');
    expect(files).toContain('design/tokens.css');
    expect(files).not.toContain('dist/Button.js');
  });

  it('calls a stylesheet an asset however it was imported', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });
    const button = records.find((record) => record.file === 'src/Button.tsx');

    expect(button?.edges).toEqual([
      { to: 'design/button.css', kind: 'asset' },
      { to: 'src/theme.ts', kind: 'type' },
      { to: 'src/util.ts', kind: 'imports' },
    ]);
    expect(button?.declares).toEqual(['Button']);
  });

  it('reads a specifier that names an extension the file does not have', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });
    const clock = records.find((record) => record.file === 'src/Clock.tsx');

    // `./util.js` is `util.ts`, which is what every TypeScript file under
    // `nodenext` looks like. Getting this wrong fails the safe way and is
    // therefore invisible: each specifier becomes a hole, each file becomes
    // opaque, every run stays green and every run is a whole run.
    expect(clock?.edges).toEqual([{ to: 'src/util.ts', kind: 'imports' }]);
    expect(clock?.unknown).toBeUndefined();
  });

  it('names a file the way the disk names it', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });
    const files = records.map((record) => record.file);

    // `src/Legacy.tsx` imports `./legacy.js`, and on a filesystem that ignores
    // case those two names are candidates for each other. A scan that trusted
    // the resolver's spelling would list a `src/legacy.tsx` nobody wrote and
    // hang the import off it, leaving the real file with no dependents at all.
    expect(files).not.toContain('src/legacy.tsx');
    expect(files).toContain('src/legacy.js');
    expect(records.find((record) => record.file === 'src/Legacy.tsx')?.edges).toEqual([
      { to: 'src/legacy.js', kind: 'imports' },
    ]);
  });

  it('drops what is outside the repository without calling it a hole', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });
    const vendor = records.find((record) => record.file === 'src/vendor.ts');

    // A builtin and an uninstalled package are both *not files in this
    // repository*, so neither can appear in a diff of it and neither widens.
    expect(vendor?.edges).toBeUndefined();
    expect(vendor?.unknown).toBeUndefined();
  });

  it('marks the file it could not read the edges of', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });
    const legacy = records.find((record) => record.file === 'src/legacy.js');

    expect(legacy?.unknown).toContain('require()');
  });

  it('answers the question the component index cannot', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });
    const moved = movedBy(relationsOfFiles(records), ['design/tokens.css']);

    // Nothing declares a component in `tokens.css`, so a scan that reads
    // declarations alone has to run the whole suite. Two hops of resolution
    // narrow it to one component — and `Legacy` rides along because its own
    // dependency is unreadable, which is stated rather than hidden.
    expect(moved.components).toEqual(['Button', 'Legacy']);
    expect(moved.opaque.map((hole) => hole.file)).toEqual(['src/legacy.js']);
    expect(moved.opaque[0]?.because).toContain('require()');
  });

  it('produces the same records twice', async () => {
    const first = await scanRelations({ root, dirs: ['src'] });
    const second = await scanRelations({ root, dirs: ['src'] });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

async function write(root: string, path: string, contents: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${contents}\n`, 'utf8');
}
