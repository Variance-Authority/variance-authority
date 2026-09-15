import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { movedBy, relationsOfFiles } from '@variance-authority/core/relate';
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

    expect(read.requests.map((request) => [request.value, request.kind])).toEqual([
      ['./types', 'type'],
      ['./b', 'imports'],
      // One type binding among values is a value import: `C` survives compilation.
      ['./cd', 'imports'],
    ]);
    expect(read.unknown).toBeUndefined();
  });

  it('keeps the typeness of each binding, not of the statement', () => {
    const read = readModule('a.tsx', 'import C, { type D, E as F } from "./cd";\n');

    // The whole point of a binding row. `D` is erased at compile time and `C`
    // and `F` are not, and a request-level kind — which has to be `imports`
    // here, because two of the three survive — cannot say which is which.
    expect(read.requests[0]?.bindings).toEqual([
      { imported: 'default', local: 'C', type: false, line: 1 },
      { imported: 'D', local: 'D', type: true, line: 1 },
      { imported: 'E', local: 'F', type: false, line: 1 },
    ]);
  });

  it('names a namespace import with a name no identifier can be', () => {
    expect(readModule('a.ts', "import * as ns from './x';\n").requests[0]?.bindings).toEqual([
      { imported: '*', local: 'ns', type: false, line: 1 },
    ]);
  });

  it('keeps a bare specifier as written, because that is the package', () => {
    const read = readModule('a.tsx', "import Button from '@atlaskit/button';\n");

    // Resolution turns this into "not a file in this repository" and stops. The
    // string is the only record that the file depends on the package at all, so
    // asking what a subtree pulls in from npm has to read it from here.
    expect(read.requests[0]?.value).toBe('@atlaskit/button');
    expect(read.requests[0]?.bindings).toEqual([
      { imported: 'default', local: 'Button', type: false, line: 1 },
    ]);
  });

  it('reads a side-effect import, which is how a stylesheet arrives', () => {
    expect(readModule('a.tsx', "import './button.css';\n").requests).toEqual([
      { value: './button.css', kind: 'imports', bindings: [], line: 1 },
    ]);
  });

  it('makes one request of a re-export that republishes many names', () => {
    const read = readModule('index.ts', "export { a, b } from './x';\nexport type { c } from './x';\n");

    // A barrel naming fifty exports of one module is one edge to it. Splitting
    // per name would multiply every barrel in the repository by its width.
    expect(read.requests).toEqual([
      {
        value: './x',
        kind: 'reexports',
        // The request's line is the first statement that wrote it; the third
        // name was republished from the second, and its binding says so.
        line: 1,
        bindings: [
          { imported: 'a', local: 'a', type: false, line: 1 },
          { imported: 'b', local: 'b', type: false, line: 1 },
          { imported: 'c', local: 'c', type: true, line: 2 },
        ],
      },
    ]);
  });

  it('reads every re-export, including the star', () => {
    const read = readModule(
      'index.ts',
      "export * from './star';\nexport { E } from './e';\nexport type { F } from './f';\n",
    );

    expect(read.requests.map((request) => [request.value, request.kind])).toEqual([
      ['./star', 'reexports'],
      ['./e', 'reexports'],
      ['./f', 'type'],
    ]);
  });

  it('publishes a name for every export, and refuses to invent one for a star', () => {
    const read = readModule(
      'index.ts',
      "export const x = 1;\nexport default function () {}\nexport * from './star';\nexport * as ns from './n';\n",
    );

    expect(read.exports).toEqual([
      { exported: 'x', local: 'x', type: false, line: 1 },
      // An anonymous default is exported and not locally accessible, so there
      // is no declaration behind it to name.
      { exported: 'default', type: false, line: 2 },
      // The set behind `export * from` is whatever the other file publishes.
      // Absent is not empty: asking whether this file exports `Card` has to
      // follow `from`, and answering no from here would be a missed edge in
      // name space rather than in file space.
      { from: './star', imported: '*', type: false, line: 3 },
      { exported: 'ns', from: './n', imported: '*', type: false, line: 4 },
    ]);
  });

  it('reads a literal dynamic import and refuses a computed one', () => {
    const read = readModule(
      'a.ts',
      'const x = import("./dyn");\nconst y = import(`./page/${name}`);\n',
    );

    expect(read.requests).toEqual([{ value: './dyn', kind: 'dynamic', bindings: [], line: 1 }]);
    // The template is quoted and still not a constant, which is exactly the
    // shape that must widen rather than resolve to a directory.
    expect(read.unknown).toContain('not a literal');
  });

  it('reads a literal require in either quote, and widens on one it cannot read', () => {
    for (const source of ["const a = require('./req');\n", 'const a = require("./req");\n']) {
      const literal = readModule('a.cjs', source);
      // Reading only the single-quoted alternative is the worst shape a bug can
      // take here: the specifier is undefined, so the edge points nowhere, and
      // the literal still counts against the call total, so the file is not
      // marked unknown either. A lost edge that does not widen is a green run.
      expect(literal.requests).toEqual([{ value: './req', kind: 'imports', bindings: [], line: 1 }]);
      expect(literal.unknown).toBeUndefined();
    }

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

    expect(read.requests.map((request) => request.value)).toEqual([
      './tokens.css',
      'sass:math',
      './mixins',
      './texture.png',
      './base.module.css',
    ]);
    expect(read.requests.every((request) => request.kind === 'asset')).toBe(true);
    // A stylesheet request is a whole-file dependency. Nothing here binds a
    // name, and `composes` names a class rather than an exported binding.
    expect(read.requests.every((request) => request.bindings.length === 0)).toBe(true);
  });
});

describe('scanning a tree', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-sense-'));

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

/**
 * The parse cache is keyed by content, and content is not the whole question.
 *
 * Two files can hold one byte for byte and still be read differently, because
 * the name decides the dialect the parser is handed and decides whether the file
 * is indexed for component declarations at all. A cache keyed on the bytes alone
 * hands whichever file the walk reached first its answer to the other — inside a
 * single scan, in an order nothing in the repository controls.
 */
describe('two files with one content', () => {
  let root: string;
  /** Digests are what makes the cache reachable: without them it is never asked. */
  let digests: Map<string, string>;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-key-'));
    await write(root, 'package.json', '{ "name": "fixture", "type": "module" }');

    const component = 'export function Widget() { return null; }';
    await write(root, 'src/widget.ts', component);
    await write(root, 'src/widget.test.ts', component);

    const sheet = "@import './tokens.css';";
    await write(root, 'src/theme.css', sheet);
    await write(root, 'src/theme.ts', sheet);

    digests = new Map([
      ['src/widget.ts', 'v1:00000000000000000000000000000001'],
      ['src/widget.test.ts', 'v1:00000000000000000000000000000001'],
      ['src/theme.css', 'v1:00000000000000000000000000000002'],
      ['src/theme.ts', 'v1:00000000000000000000000000000002'],
    ]);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('does not hand a test file\'s answer to the component beside it', async () => {
    const records = await scanRelations({ root, dirs: ['src'], digests });

    expect(records.find((record) => record.file === 'src/widget.ts')?.declares).toEqual(['Widget']);
    expect(records.find((record) => record.file === 'src/widget.test.ts')?.declares).toBeUndefined();
  });

  it('does not read a stylesheet as a module, or the other way round', async () => {
    const records = await scanRelations({ root, dirs: ['src'], digests });
    const sheet = records.find((record) => record.file === 'src/theme.css');
    const module = records.find((record) => record.file === 'src/theme.ts');

    expect(sheet?.unresolved).toEqual(['./tokens.css']);
    expect(module?.unresolved).toBeUndefined();
  });
});

async function write(root: string, path: string, contents: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${contents}\n`, 'utf8');
}
