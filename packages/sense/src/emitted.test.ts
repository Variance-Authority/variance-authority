import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { emittedFrom } from './emitted.js';
import { native, nativeAvailable } from './native.js';
import { realPath, resolveTo, resolversFor } from './resolve.js';

/**
 * A workspace package whose manifest exports its build.
 *
 * `@acme/lib` exports `./dist/index.js`, and its `tsconfig` builds `src/` into
 * `dist/`: `outDir` comes from a base config through `${configDir}`, `rootDir`
 * sits beside the `extends`. Nobody edits `dist/`, and a checkout often has
 * none, so the import from `app` is an import of `src/index.ts` and reads as one
 * whether or not the build ran. A second config builds `src/` again into
 * `dist/lib/esm`, inside the first `outDir` but not directly. `@acme/bare` writes `outDir` and no `rootDir`,
 * which TypeScript 5 and 6 answer differently, so its output is not read back.
 * `@acme/split` type-checks its root with a `tsconfig.json` that inherits
 * `noEmit`, and builds `src/` with a `tsconfig.build.json` that lifts it, so
 * only the second says where `dist/` comes from. `@acme/shared` builds with
 * both, each writing into `dist/`, and only the second mirrors `src/`.
 * `@acme/typed` writes declarations and leaves its code to a bundler, so its
 * `dist/index.js` is the bundler's and is read as itself.
 */

const SOURCE = 'packages/lib/src/index.ts';
const NESTED = 'packages/lib/src/sub/index.ts';
const SPLIT = 'packages/split/src/index.ts';
const SHARED = 'packages/shared/src/index.ts';
const TYPED = 'packages/typed/src/index.ts';
const REQUESTS = {
  lib: '@acme/lib',
  sub: '@acme/lib/sub',
  gone: '@acme/lib/gone',
  bare: '@acme/bare',
  split: '@acme/split',
  shared: '@acme/shared',
  typed: '@acme/typed',
  types: '@acme/typed/types',
} as const;
type Request = keyof typeof REQUESTS;
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** The workspace, with `files` laid over it. */
async function workspace(files: Readonly<Record<string, string>> = {}): Promise<string> {
  const root = realPath(await mkdtemp(join(tmpdir(), 'variance-emitted-')));
  roots.push(root);
  const base: Record<string, string> = {
    'package.json': '{ "name": "fixture", "private": true, "workspaces": ["packages/*"] }',
    'tsconfig.base.json': '{ "compilerOptions": { "outDir": "${configDir}/dist" } }',
    'packages/lib/package.json': JSON.stringify({
      name: '@acme/lib',
      type: 'module',
      exports: { '.': './dist/index.js', './sub': './dist/sub/index.js', './gone': './dist/gone.js' },
    }),
    'packages/lib/tsconfig.json': '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "rootDir": "./src" } }',
    'packages/lib/tsconfig.esm.json': '{ "compilerOptions": { "outDir": "./dist/lib/esm", "rootDir": "./src" } }',
    [SOURCE]: 'export const clamp = (n: number) => n;\n',
    [NESTED]: 'export const nested = 1;\n',
    'packages/bare/package.json': '{ "name": "@acme/bare", "type": "module", "exports": "./dist/index.js" }',
    'packages/bare/tsconfig.json': '{ "compilerOptions": { "outDir": "./dist" } }',
    'packages/bare/src/index.ts': 'export const bare = 1;\n',
    'tsconfig.check.json': '{ "extends": "./tsconfig.base.json", "compilerOptions": { "noEmit": true } }',
    'packages/split/package.json': '{ "name": "@acme/split", "type": "module", "exports": "./dist/index.js" }',
    'packages/split/tsconfig.json': '{ "extends": "../../tsconfig.check.json", "compilerOptions": { "rootDir": "." } }',
    'packages/split/tsconfig.build.json':
      '{ "extends": "../../tsconfig.check.json", "compilerOptions": { "noEmit": false, "rootDir": "./src" } }',
    [SPLIT]: 'export const split = 1;\n',
    'packages/shared/package.json': '{ "name": "@acme/shared", "type": "module", "exports": "./dist/index.js" }',
    'packages/shared/tsconfig.json': '{ "compilerOptions": { "outDir": "./dist", "rootDir": "." } }',
    'packages/shared/tsconfig.build.json': '{ "extends": "./tsconfig.json", "compilerOptions": { "rootDir": "./src" } }',
    [SHARED]: 'export const shared = 1;\n',
    'packages/typed/package.json': JSON.stringify({
      name: '@acme/typed',
      type: 'module',
      exports: { '.': './dist/index.js', './types': './dist/index.d.ts' },
    }),
    'packages/typed/tsconfig.json':
      '{ "compilerOptions": { "outDir": "./dist", "rootDir": "./src", "emitDeclarationOnly": true } }',
    [TYPED]: 'export const typed = 1;\n',
    'packages/app/package.json': '{ "name": "@acme/app", "type": "module" }',
  };
  for (const [name, request] of Object.entries(REQUESTS)) {
    base[importer(name as Request)] = `import * as used from '${request}';\nexport default used;\n`;
  }
  for (const [path, contents] of Object.entries({ ...base, ...files })) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  await mkdir(join(root, 'node_modules/@acme'), { recursive: true });
  await symlink('../../packages/lib', join(root, 'node_modules/@acme/lib'));
  await symlink('../../packages/bare', join(root, 'node_modules/@acme/bare'));
  for (const name of ['split', 'shared', 'typed']) {
    await symlink(`../../packages/${name}`, join(root, `node_modules/@acme/${name}`));
  }
  return root;
}

/** What a build leaves: output for every source, and one whose source was deleted since. */
const BUILT = {
  'packages/lib/dist/index.js': 'export const clamp = (n) => n;\n',
  'packages/lib/dist/index.d.ts': 'export declare const clamp: (n: number) => number;\n',
  'packages/lib/dist/sub/index.js': 'export const nested = 1;\n',
  'packages/lib/dist/gone.js': 'export const gone = 1;\n',
  'packages/bare/dist/index.js': 'export const bare = 1;\n',
  'packages/split/dist/index.js': 'export const split = 1;\n',
  'packages/shared/dist/index.js': 'export const shared = 1;\n',
  'packages/typed/dist/index.js': 'export const typed = 1;\n',
  'packages/typed/dist/index.d.ts': 'export declare const typed = 1;\n',
};

function importer(name: Request): string {
  return `packages/app/src/${name}.ts`;
}

/** Where the native scan lands each request, `''` for nowhere. */
function scanned(root: string): Record<Request, string> {
  const entries = Object.keys(REQUESTS).map((name) => {
    const batch = native()!.scanBatch(root, [importer(name as Request)]);
    return [name, batch.targets[0] ?? ''];
  });
  return Object.fromEntries(entries) as Record<Request, string>;
}

/** Where the JavaScript oracle lands each request, `''` for nowhere. */
function oracle(root: string): Record<Request, string> {
  const resolvers = resolversFor({});
  const entries = Object.entries(REQUESTS).map(([name, request]) => [
    name,
    resolveTo({ resolvers, root, from: join(root, importer(name as Request)), request, language: 'module' }) ?? '',
  ]);
  return Object.fromEntries(entries) as Record<Request, string>;
}

/**
 * Where each request lands. `@acme/typed`'s code is under the excluded `dist/`
 * whether a bundler wrote it or not, so it lands nowhere either way.
 */
const LANDED: Record<Request, string> = {
  lib: SOURCE, sub: NESTED, gone: '', bare: '', split: SPLIT, shared: SHARED, typed: '', types: TYPED,
};

describe('built output, read as the source it is built from', () => {
  it('answers a path under `outDir` with its source, and nothing when the source is gone', async () => {
    const root = await workspace(BUILT);
    const emitted = emittedFrom();

    expect(emitted(join(root, 'packages/lib/dist/index.js'))).toBe(join(root, SOURCE));
    expect(emitted(join(root, 'packages/lib/dist/index.d.ts'))).toBe(join(root, SOURCE));
    expect(emitted(join(root, 'packages/lib/dist/sub/index.js'))).toBe(join(root, NESTED));
    expect(emitted(join(root, 'packages/lib/dist/lib/esm/index.js'))).toBe(join(root, SOURCE));
    expect(emitted(join(root, 'packages/lib/dist/gone.js'))).toBeNull();
    expect(emitted(join(root, 'packages/lib/src/index.ts'))).toBeUndefined();
    expect(emitted(join(root, 'packages/bare/dist/index.js'))).toBeUndefined();
    expect(emitted(join(root, 'packages/split/dist/index.js'))).toBe(join(root, SPLIT));
    expect(emitted(join(root, 'packages/shared/dist/index.js'))).toBe(join(root, SHARED));
    expect(emitted(join(root, 'packages/typed/dist/index.js'))).toBeUndefined();
    expect(emitted(join(root, 'packages/typed/dist/index.d.ts'))).toBe(join(root, TYPED));
  });

  it.runIf(nativeAvailable())('lands the scan on the source when nothing was built', async () => {
    const root = await workspace();

    expect(scanned(root)).toEqual(LANDED);
  });

  it.runIf(nativeAvailable())('lands the scan and the oracle on the source once it was', async () => {
    const root = await workspace(BUILT);
    expect(scanned(root)).toEqual(LANDED);
    expect(oracle(root)).toEqual(LANDED);
  });

  it.runIf(nativeAvailable())('reads a package the checkout links to from its source, through git as from the disk', async () => {
    // Git lists a committed symbolic link as a file, and this one names a
    // package directory, so the tree must not vouch that it holds nothing.
    const file = 'packages/app/src/linked.ts';
    const root = await workspace({
      '.gitignore': 'node_modules\n',
      'vendor/linked/package.json': '{ "name": "@acme/linked", "type": "module", "exports": "./dist/index.js" }',
      'vendor/linked/tsconfig.json': '{ "compilerOptions": { "outDir": "./dist", "rootDir": "./src" } }',
      'vendor/linked/src/index.ts': 'export const linked = 1;\n',
      [file]: "import * as used from '../../linked/dist/index.js';\nexport default used;\n",
    });
    await symlink('../vendor/linked', join(root, 'packages/linked'));
    const git = (...args: string[]): void => {
      execFileSync('git', args, {
        cwd: root, stdio: 'ignore',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.test',
          GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.test',
        },
      });
    };
    git('init', '--quiet');
    git('add', '.');
    git('commit', '--quiet', '-m', 'fixture');
    const tree = native()!.gitTreeFor(root, ['.'])!;

    expect(tree.scanBatch(root, [file]).targets).toEqual(['vendor/linked/src/index.ts']);
    expect(native()!.scanBatch(root, [file]).targets).toEqual(['vendor/linked/src/index.ts']);
  });
});
