import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { OFFERED, ownership, readImportTargets, readOfferings } from './manifest.js';

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), './__fixtures__/workspace');

const temporary: string[] = [];

/** A workspace written from a map of relative path to contents. */
function workspace(files: Readonly<Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), 'variance-manifest-'));
  temporary.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  return root;
}

afterAll(() => {
  for (const root of temporary) rmSync(root, { recursive: true, force: true });
});

describe('what a manifest offers', () => {
  it('names where the code is and what lands in the tarball', () => {
    expect(OFFERED).toContain('exports');
    expect(OFFERED).toContain('files');
    expect(OFFERED).toContain('bin');
  });

  it('names no kind of dependency', () => {
    // A dependency graph is a different subject with different questions —
    // which range, which duplicate, which transitive licence — and tools built
    // for it answer them. This records what a package offers, not what it needs.
    expect(OFFERED.filter((key) => key.toLowerCase().includes('dependencies'))).toEqual([]);
    expect(OFFERED).not.toContain('version');
  });
});

describe('reading a workspace', () => {
  const offerings = readOfferings(WORKSPACE);
  const names = offerings.map((offering) => offering.name);

  it('finds every member of a `dir/*` glob and of a literal path', () => {
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names).toContain('solo');
  });

  it('leaves out what a manifest says not to publish', () => {
    expect(names).not.toContain('hidden');
  });

  it('records the offered keys verbatim and nothing else', () => {
    const beta = offerings.find((offering) => offering.name === 'beta');
    expect(Object.keys(beta!.declared).sort()).toEqual(['bin', 'exports', 'files', 'main', 'type', 'types']);
    expect(beta!.declared['bin']).toEqual({ beta: './dist/bin.js' });
  });

  it('records only the keys an option asks for', () => {
    const [first] = readOfferings(WORKSPACE, { offered: ['files'] });
    expect(Object.keys(first!.declared)).toEqual(['files']);
  });

  it('records whether a manifest declares an entry, `typings` alone included, whichever keys it is asked to record', () => {
    const root = workspace({
      'package.json': { private: true, workspaces: ['packages/*'] },
      'packages/typed/package.json': { name: '@acme/typed', typings: 'dist/index.d.ts' },
      'packages/kit/package.json': { name: '@acme/kit' },
    });
    const offerings = readOfferings(root, { offered: ['files'], tolerant: true });

    expect(Object.fromEntries(offerings.map((offering) => [offering.name, offering.entry]))).toEqual({ '@acme/kit': false, '@acme/typed': true });
    expect([...readImportTargets(root).unentered]).toEqual(['@acme/kit']);
  });

  it('maps a published declaration back to the source it was compiled from', () => {
    const alpha = offerings.find((offering) => offering.name === 'alpha');
    const at = (subpath: string) =>
      alpha!.entrypoints.find((entry) => entry.subpath === subpath)?.source.slice(WORKSPACE.length);

    expect(at('.')).toBe('/packages/alpha/src/index.ts');
    // A component entrypoint is a normal thing to publish, and `.d.ts` says
    // nothing about which of the two extensions produced it.
    expect(at('./widget')).toBe('/packages/alpha/src/widget.tsx');
    // Already source. Nothing to undo.
    expect(at('./direct')).toBe('/packages/alpha/src/direct.ts');
  });

  it('opens a subpath written as a bare path to source', () => {
    // The shape a repository publishing its own TypeScript writes, and the one
    // most manifests outside this workspace use. Read as `no types condition`,
    // it left a package that had said exactly where its code was opening
    // nothing at all.
    const alpha = offerings.find((offering) => offering.name === 'alpha');
    const plain = alpha!.entrypoints.find((entry) => entry.subpath === './plain');
    expect(plain?.source.slice(WORKSPACE.length)).toBe('/packages/alpha/src/plain.ts');
  });

  it('opens a subpath whose types sit one level down, under `import`', () => {
    const alpha = offerings.find((offering) => offering.name === 'alpha');
    const nested = alpha!.entrypoints.find((entry) => entry.subpath === './nested');
    expect(nested?.source.slice(WORKSPACE.length)).toBe('/packages/alpha/src/nested.ts');
  });

  it('keeps a subpath that declares no types, and opens nothing for it', () => {
    const alpha = offerings.find((offering) => offering.name === 'alpha');
    expect(Object.keys(alpha!.declared['exports'] as object)).toContain('./raw');
    expect(alpha!.entrypoints.map((entry) => entry.subpath)).not.toContain('./raw');
  });

  it('reads comments and trailing commas in a package tsconfig', () => {
    const root = workspace({
      'package.json': { name: 'jsonc', exports: { '.': { types: './dist/index.d.ts' } } },
      'tsconfig.json': '/* inherited settings */\n{"compilerOptions":{"rootDir":"src","outDir":"dist",},}',
      'src/index.ts': 'export const value = 1;\n',
    });
    expect(readOfferings(root)[0]?.entrypoints[0]?.source).toBe(join(root, 'src/index.ts'));
  });

  it('expands a source wildcard into the subpaths that exist', () => {
    const root = workspace({
      'package.json': { name: 'pattern', exports: { './services/*': './src/services/*.ts' } },
      'src/services/first.ts': 'export const first = 1;\n',
      'src/services/second.ts': 'export const second = 2;\n',
    });
    expect(readOfferings(root)[0]?.entrypoints.map((entry) => entry.subpath)).toEqual([
      './services/first',
      './services/second',
    ]);
  });

  it('keeps an authored declaration file when no emit mapping exists', () => {
    const root = workspace({
      'package.json': { name: 'ambient', exports: { '.': { types: './src/index.d.ts' } } },
      'tsconfig.json': '{"compilerOptions":{}}',
      'src/index.d.ts': 'export declare const value: number;\n',
    });
    expect(readOfferings(root)[0]?.entrypoints[0]?.source).toBe(join(root, 'src/index.d.ts'));
  });

  it('opens a JavaScript export by the declaration file written beside it', () => {
    // What TypeScript resolves `./src/index.js` to, and how a package whose
    // source is JavaScript with hand-written types publishes them.
    const root = workspace({
      'package.json': {
        name: 'beside',
        exports: { '.': './src/index.js', './*': './src/*/index.js', './raw': './raw.js', './tool': './dist/tool.cjs' },
      },
      // Emitted by a build, so present only when one ran: never an opening.
      'tsconfig.json': { compilerOptions: { rootDir: './src', outDir: './dist' } },
      'dist/tool.cjs': 'module.exports = {};\n',
      'dist/tool.d.cts': 'export {};\n',
      'src/index.js': 'export const value = 1;\n',
      'src/index.d.ts': 'export declare const value: number;\n',
      'src/Button/index.js': 'export const Button = 1;\n',
      'src/Button/index.d.ts': 'export declare const Button: number;\n',
      'raw.js': 'export const raw = 1;\n',
    });
    const [beside] = readOfferings(root);
    expect(beside?.entrypoints.map((entry) => [entry.subpath, entry.source.slice(root.length)])).toEqual([
      ['.', '/src/index.d.ts'],
      ['./Button', '/src/Button/index.d.ts'],
    ]);
  });
});

describe('what it refuses rather than guesses', () => {
  const manifest = { name: 'one', exports: { '.': { types: './dist/index.d.ts' } } };

  it('a published declaration with no tsconfig to say what produced it', () => {
    const root = workspace({ 'package.json': manifest });
    expect(() => readOfferings(root)).toThrow(/not there to say what produced it/);
  });

  it('a tsconfig that declares no rootDir/outDir pair', () => {
    const root = workspace({ 'package.json': manifest, 'tsconfig.json': { compilerOptions: {} } });
    expect(() => readOfferings(root)).toThrow(/declares no `rootDir`\/`outDir` pair/);
  });

  it('a declaration that is not under the outDir it claims', () => {
    const root = workspace({
      'package.json': manifest,
      'tsconfig.json': { compilerOptions: { rootDir: './src', outDir: './build' } },
    });
    expect(() => readOfferings(root)).toThrow(/is not under this package's outDir/);
  });

  it('a declaration whose source is not on disk', () => {
    const root = workspace({
      'package.json': manifest,
      'tsconfig.json': { compilerOptions: { rootDir: './src', outDir: './dist' } },
    });
    expect(() => readOfferings(root)).toThrow(/maps to `.*src\/index.ts`, which is not there/);
  });

  it('records one stale opening without hiding the rest when tolerance is requested', () => {
    const root = workspace({
      'package.json': {
        name: 'mixed',
        exports: {
          '.': './src/index.ts',
          './stale': { types: './dist/stale.d.ts' },
        },
      },
      'tsconfig.json': { compilerOptions: { rootDir: './src', outDir: './dist' } },
      'src/index.ts': 'export const value = 1;\n',
    });
    const [offering] = readOfferings(root, { tolerant: true });
    expect(offering?.entrypoints.map((entry) => entry.subpath)).toEqual(['.']);
    expect(offering?.unreadable?.[0]).toMatch(/mixed \.\/stale/);
  });
});

describe('which subpaths an `exports` field opens', () => {
  /** `[subpath, source]` per entrypoint of the one package in `files`. */
  const opened = (files: Readonly<Record<string, unknown>>) => {
    const root = workspace(files);
    return readOfferings(root)[0]?.entrypoints.map((entry) => [entry.subpath, entry.source.slice(root.length)]);
  };

  it('keeps every key of a map whose keys all start with `.` as its own subpath', () => {
    expect(
      opened({
        'package.json': { name: 'mapped', exports: { '.': './src/index.ts', './extra': { types: './src/extra.ts' } } },
        'src/index.ts': 'export const one = 1;\n',
        'src/extra.ts': 'export const two = 2;\n',
      }),
    ).toEqual([
      ['.', '/src/index.ts'],
      ['./extra', '/src/extra.ts'],
    ]);
  });

  it('finds the declarations of a subpath under conditions nested two deep', () => {
    expect(
      opened({
        'package.json': { name: 'deep', exports: { '.': { node: { import: { types: './dist/index.d.ts' } } } } },
        'tsconfig.json': { compilerOptions: { rootDir: './src', outDir: './dist' } },
        'src/index.ts': 'export const one = 1;\n',
      }),
    ).toEqual([['.', '/src/index.ts']]);
  });

  it('reads an object with no `.` key as the conditions of `.`, a custom condition included', () => {
    // `@tanstack/solid-query`'s shape. Read as subpaths, it published
    // `@tanstack/solid-querytanstack/custom-condition` and no `.` at all.
    const exports = {
      '@tanstack/custom-condition': './src/index.ts',
      development: { import: { types: './build/index.d.ts', default: './build/dev.js' } },
      import: { types: './build/index.d.ts', default: './build/index.js' },
    };
    expect(
      opened({
        'package.json': { name: 'root', private: true, workspaces: ['packages/*'] },
        'tsconfig.json': { compilerOptions: { customConditions: ['@tanstack/custom-condition'] } },
        'packages/solid/package.json': { name: 'solid', exports },
        'packages/solid/tsconfig.json': { extends: '../../tsconfig.json', compilerOptions: { outDir: './dist-ts', rootDir: '.' } },
        'packages/solid/src/index.ts': 'export const useQuery = 1;\n',
      }),
    ).toEqual([['.', '/packages/solid/src/index.ts']]);
  });

  it('reads the custom condition from a commented config a package specifier `extends` names', () => {
    expect(
      opened({
        'package.json': { name: 'shared', exports: { '@t/source': './src/index.ts', types: './dist/index.d.ts' } },
        'tsconfig.json': { extends: '@t/tsconfig/base.json' },
        'node_modules/@t/tsconfig/base.json': '/* shared */\n{ "compilerOptions": { "customConditions": ["@t/source"], }, }\n',
        'src/index.ts': 'export const one = 1;\n',
      }),
    ).toEqual([['.', '/src/index.ts']]);
  });

  it('reads a condition-only object with no custom condition as `.`', () => {
    expect(
      opened({
        'package.json': { name: 'sugar', exports: { import: './a.js', types: './a.d.ts' } },
        'tsconfig.json': { compilerOptions: {} },
        'a.d.ts': 'export declare const a: number;\n',
      }),
    ).toEqual([['.', '/a.d.ts']]);
  });

  it('reads a string `exports` as `.`', () => {
    expect(
      opened({ 'package.json': { name: 'string', exports: './src/index.ts' }, 'src/index.ts': 'export const one = 1;\n' }),
    ).toEqual([['.', '/src/index.ts']]);
  });

  it('finds the declarations of `.` under nested conditions', () => {
    expect(
      opened({
        'package.json': { name: 'nested', exports: { node: { import: { types: './dist/index.d.ts' } } } },
        'tsconfig.json': { compilerOptions: { rootDir: './src', outDir: './dist' } },
        'src/index.ts': 'export const one = 1;\n',
      }),
    ).toEqual([['.', '/src/index.ts']]);
  });

  it('takes the first entry of an array fallback that names something to open', () => {
    expect(
      opened({
        'package.json': { name: 'fallback', exports: [{ worker: './worker.cjs' }, './src/index.ts'] },
        'src/index.ts': 'export const one = 1;\n',
      }),
    ).toEqual([['.', '/src/index.ts']]);
  });

  it('opens the source a custom condition names before a `types` target the checkout does not hold', () => {
    // Zod's shape: `index.d.cts` is emitted by its build and ignored by git, so
    // a fresh clone has only the `@zod/source` branch to read.
    const condition = (at: string) => ({
      '@zod/source': `./src/${at}index.ts`,
      types: `./${at}index.d.cts`,
      import: `./${at}index.js`,
    });
    expect(
      opened({
        'package.json': {
          name: 'zod',
          exports: {
            './package.json': './package.json',
            '.': condition(''),
            './mini': condition('mini/'),
            './locales/*': { '@zod/source': './src/locales/*', types: './locales/*' },
          },
        },
        'tsconfig.json': { compilerOptions: { customConditions: ['@zod/source'], noEmit: true } },
        'src/index.ts': 'export const z = 1;\n',
        'src/mini/index.ts': 'export const mini = 1;\n',
        'src/locales/fr.ts': 'export const fr = 1;\n',
        'src/locales/fr.d.ts': 'export declare const fr: number;\n',
      }),
    ).toEqual([
      ['.', '/src/index.ts'],
      ['./mini', '/src/mini/index.ts'],
      // A consumer writes the extension the file is emitted as.
      ['./locales/fr.js', '/src/locales/fr.ts'],
    ]);
  });

  it('refuses an object that mixes subpaths and conditions, naming the manifest', () => {
    const root = workspace({
      'package.json': { name: 'mixed', exports: { '.': './src/index.ts', import: './src/index.ts' } },
      'src/index.ts': 'export const one = 1;\n',
    });
    expect(() => readOfferings(root)).toThrow(/package\.json mixes subpaths with the conditions `import`/);
    expect(readOfferings(root, { tolerant: true })[0]?.unreadable?.[0]).toMatch(/^mixed — .*Node refuses/);
  });
});

describe('a repository that is not a monorepo', () => {
  it('is one package, read from the manifest at its root', () => {
    const root = workspace({
      'package.json': { name: 'only', exports: { '.': { types: './src/index.ts' } } },
      'src/index.ts': 'export const one = 1;\n',
    });
    expect(readOfferings(root).map((offering) => offering.name)).toEqual(['only']);
  });

  it('publishes nothing when nothing at its root is a manifest, rather than refusing to be read', () => {
    const root = workspace({
      'Sources/App/main.swift': 'print("hello")\n',
      'landing/src/index.ts': 'export const one = 1;\n',
    });
    expect(readOfferings(root)).toEqual([]);
  });

  it('reads a manifest below the root only as the owner of the files under it', () => {
    const root = workspace({
      'landing/package.json': { name: 'landing' },
      'landing/src/index.ts': 'export const one = 1;\n',
    });
    // Not an offering: nothing at the root claims it, and inventing a workspace
    // nobody declared would publish a name its own repository never published.
    expect(readOfferings(root)).toEqual([]);
    expect(ownership(root)('landing/src/index.ts')).toBe('landing');
  });
});

describe('a pnpm workspace', () => {
  // pnpm declares its members in `pnpm-workspace.yaml`, and its root manifest
  // carries no `workspaces`: read as one package, the private root publishes
  // nothing and every member goes missing.
  const members = {
    'package.json': { name: 'mono', private: true },
    'packages/mui-alpha/package.json': { name: '@scope/alpha', exports: { '.': './src/index.ts' } },
    'packages/mui-alpha/src/index.ts': 'export const alpha = 1;\n',
    'docs/package.json': { name: 'docs' },
  };

  it('reads its members from the file pnpm reads them from', () => {
    const root = workspace({
      ...members,
      'pnpm-workspace.yaml': "packages:\n  - packages/*\n  # the site\n  - 'docs'\n\nengineStrict: true\n",
    });
    expect(readOfferings(root).map((offering) => offering.name)).toEqual(['@scope/alpha', 'docs']);
  });
});

describe('a package with no `exports`', () => {
  // Without `exports`, Node loads `main` for the bare name and any file of the
  // package by its path, and TypeScript reads `types`, then `typings`, then
  // `main`. A monorepo's internal library is very often written this way.
  const opened = (manifest: Record<string, unknown>, files: Readonly<Record<string, string>> = {}) =>
    readOfferings(workspace({ 'package.json': manifest, 'src/index.ts': 'export const one = 1;\n', ...files })).map(
      (offering) => offering.entrypoints.map((entry) => [entry.subpath, entry.source.slice(entry.source.indexOf('src/'))]),
    );

  it('opens `.` at the source `main` names', () => {
    expect(opened({ name: 'lib', main: 'src/index.ts' })).toEqual([[['.', 'src/index.ts']]]);
  });

  it('opens `.` at `types` before `main`, mapping an emitted declaration back to its source', () => {
    const tsconfig = JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: 'dist' } });
    const manifest = { name: 'lib', main: './dist/index.js', types: './dist/index.d.ts' };
    expect(opened(manifest, { 'tsconfig.json': tsconfig })).toEqual([[['.', 'src/index.ts']]]);
  });

  it('opens `.` at `typings` when that is the key a manifest writes', () => {
    expect(opened({ name: 'lib', main: './index.js', typings: './src/index.ts' })).toEqual([[['.', 'src/index.ts']]]);
  });

  it('opens `.` at the TypeScript source a `.js` `main` is compiled from, when nothing declares it', () => {
    expect(opened({ name: 'lib', main: './src/index.js' })).toEqual([[['.', 'src/index.ts']]]);
    const component = { 'src/view.tsx': 'export const View = 1;\n' };
    expect(opened({ name: 'lib', main: 'src/view.js' }, component)).toEqual([[['.', 'src/view.tsx']]]);
    expect(opened({ name: 'lib', main: './src/index.mjs' }, { 'src/index.mts': 'export const one = 1;\n' })).toEqual([[['.', 'src/index.mts']]]);
  });

  it('still leaves out a private package', () => {
    expect(opened({ name: 'app', private: true, main: 'src/index.ts' })).toEqual([]);
  });

  it('is not what a package with `exports` opens: `main` is then only the legacy entry', () => {
    const manifest = { name: 'lib', main: 'src/other.ts', exports: { '.': './src/index.ts' } };
    expect(opened(manifest, { 'src/other.ts': 'export const two = 2;\n' })).toEqual([[['.', 'src/index.ts']]]);
    expect(opened({ name: 'lib', main: 'src/index.ts', exports: {} })).toEqual([[]]);
  });
});

it.todo(
  'a condition object with no `types`, such as `{ "import": "./src/index.js" }`, opens by the `.d.ts` beside its first JavaScript target — needs `besideOf` to read condition objects',
);
it.todo(
  'a `.d.ts` beside a bare `.js` export opens only when the repository tracks it, so a build output in `dist` opens nothing — needs `besideOf` to ask git which siblings are tracked',
);
