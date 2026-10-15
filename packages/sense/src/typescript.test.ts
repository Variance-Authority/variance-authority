import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { updateNatively } from './native-update.js';
import { readPublishedSources, updateSourceIndex } from './published.js';
import { realPath } from './resolve.js';
import { scanRelations } from './scan.js';
import { importReferences } from './test-selection/references.js';
import { declaredTsconfig, parseTypescript, TypescriptError } from './typescript.js';
import { tsconfigUse } from './typescript-use.js';

/**
 * The `typescript` key of the root config: which `tsconfig` governs resolution,
 * or none.
 *
 * The fixture is a workspace whose `@acme/lib` exports its source only under a
 * condition the root `tsconfig.json` names, so whether the edge from `app` to
 * `lib` is there says whether that config was read.
 */

const IMPORTER = 'packages/app/src/index.ts';
const TARGET = 'packages/lib/src/index.ts';
const WITH = '{ "compilerOptions": { "customConditions": ["@acme/source"] } }';
const WITHOUT = '{ "compilerOptions": { "strict": true } }';
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** A committed checkout of the workspace, with `files` laid over it. */
async function workspace(files: Readonly<Record<string, string>>): Promise<string> {
  const root = realPath(await mkdtemp(join(tmpdir(), 'variance-typescript-')));
  roots.push(root);
  const base: Record<string, string> = {
    'package.json': '{ "name": "fixture", "private": true, "workspaces": ["packages/*"] }',
    'packages/lib/package.json': JSON.stringify({
      name: '@acme/lib',
      type: 'module',
      exports: { '.': { '@acme/source': './src/index.ts', import: './dist/index.js' } },
    }),
    [TARGET]: 'export const clamp = (n: number) => n;\n',
    'packages/app/package.json': '{ "name": "@acme/app", "type": "module" }',
    [IMPORTER]: "import { clamp } from '@acme/lib';\nexport const App = () => clamp(1);\n",
  };
  for (const [path, contents] of Object.entries({ ...base, ...files })) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  await mkdir(join(root, 'node_modules/@acme'), { recursive: true });
  await symlink('../../packages/lib', join(root, 'node_modules/@acme/lib'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '--quiet');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');
  return root;
}

async function scanned(root: string): Promise<readonly string[]> {
  const records = await scanRelations({ root, dirs: ['packages'] });
  return records.find((record) => record.file === IMPORTER)?.edges?.map((edge) => edge.to) ?? [];
}

const declaring = (typescript: unknown) => JSON.stringify({ typescript });

describe('parseTypescript', () => {
  it('takes auto, a path and false', () => {
    expect(parseTypescript({ tsconfig: 'auto' }, 'v.json')).toEqual({ tsconfig: 'auto' });
    expect(parseTypescript({ tsconfig: 'tsconfig.app.json' }, 'v.json')).toEqual({ tsconfig: 'tsconfig.app.json' });
    expect(parseTypescript({ tsconfig: false }, 'v.json')).toEqual({ tsconfig: false });
    expect(parseTypescript({}, 'v.json')).toEqual({ tsconfig: 'auto' });
  });

  it('refuses anything else, naming the field', () => {
    for (const value of [true, [], 'auto', { tsconfig: true }, { tsconfig: null }, { tsconfig: '' }, { tsconfig: '/abs/tsconfig.json' }, { other: 1 }]) {
      expect(() => parseTypescript(value, 'v.json'), JSON.stringify(value)).toThrow(TypescriptError);
    }
    expect(() => parseTypescript({ tsconfig: '/abs/tsconfig.json' }, 'v.json')).toThrow(/repository root/u);
  });
});

describe('the tsconfig the root config declares', () => {
  it('declares nothing without the key', async () => {
    const root = await workspace({ 'tsconfig.json': WITH, 'variance.config.json': '{}' });

    expect(declaredTsconfig(root)).toBeUndefined();
  });

  it('places a named config against the repository root, and refuses one that is not there', async () => {
    const root = await workspace({
      'tsconfig.json': WITH,
      'tsconfig.app.json': WITH,
      'variance.config.json': declaring({ tsconfig: 'tsconfig.app.json' }),
    });
    const missing = await workspace({ 'variance.config.json': declaring({ tsconfig: 'tsconfig.app.json' }) });

    expect(declaredTsconfig(join(root, 'packages/app'))).toBe(join(root, 'tsconfig.app.json'));
    expect(() => declaredTsconfig(missing)).toThrow(/tsconfig\.app\.json.*not a file/u);
  });

  it('refuses a named config outside the repository, which no record of it could name', async () => {
    const outside = realPath(await mkdtemp(join(tmpdir(), 'variance-typescript-outside-')));
    roots.push(outside);
    await writeFile(join(outside, 'tsconfig.json'), WITH);
    const root = await workspace({ 'variance.config.json': declaring({ tsconfig: `../${basename(outside)}/tsconfig.json` }) });

    expect(() => declaredTsconfig(root)).toThrow(/repository root/u);
  });

  it('reads no tsconfig when it says false, so the condition only a tsconfig names is not followed', async () => {
    const root = await workspace({ 'tsconfig.json': WITH, 'variance.config.json': declaring({ tsconfig: false }) });

    expect(await scanned(root)).not.toContain(TARGET);
  });

  it('reads the config it names rather than the one discovered', async () => {
    const root = await workspace({
      'tsconfig.json': WITHOUT,
      'tsconfig.app.json': WITH,
      'variance.config.json': declaring({ tsconfig: 'tsconfig.app.json' }),
    });

    expect(await scanned(root)).toContain(TARGET);
  });

  it('publishes the source index under it, and the warm update in the addon accepts that index', async () => {
    const root = await workspace({ 'tsconfig.json': WITH, 'variance.config.json': declaring({ tsconfig: false }) });
    const cache = realPath(await mkdtemp(join(tmpdir(), 'variance-typescript-index-')));
    roots.push(cache);
    const index = join(cache, 'source-index.bin');

    await updateSourceIndex(root, { index });
    const record = (await readPublishedSources(index)).records.find((found) => found.file === IMPORTER);

    expect(record?.edges?.map((edge) => edge.to) ?? []).not.toContain(TARGET);
    expect(await updateNatively(root, index)).toMatchObject({ reread: 0 });
  });
});

describe('where an import lands, asked after the scan', () => {
  // A diff's added import is landed apart from the scan that built the index,
  // and lands where that scan would have put it.
  const landed = (root: string) => importReferences(root, undefined, IMPORTER)?.imported ?? [];

  it('follows the condition the discovered config names when the root config says nothing', async () => {
    const root = await workspace({ 'tsconfig.json': WITH });

    expect(landed(root)).toContain(TARGET);
  });

  it('follows no condition when the root config turns the tsconfig off', async () => {
    const root = await workspace({ 'tsconfig.json': WITH, 'variance.config.json': declaring({ tsconfig: false }) });

    expect(landed(root)).not.toContain(TARGET);
  });

  it('reads the config the root config names rather than the one discovered', async () => {
    const root = await workspace({
      'tsconfig.json': WITHOUT,
      'tsconfig.app.json': WITH,
      'variance.config.json': declaring({ tsconfig: 'tsconfig.app.json' }),
    });

    expect(landed(root)).toContain(TARGET);
  });
});

describe('what the tracked tsconfigs ask of a resolution', () => {
  it('names no config when none declares a condition or a path, so turning them off loses nothing', async () => {
    const root = await workspace({ 'tsconfig.json': WITHOUT, 'packages/app/tsconfig.json': WITHOUT });

    expect(await tsconfigUse(root)).toEqual({
      declared: undefined,
      under: '',
      configs: ['packages/app/tsconfig.json', 'tsconfig.json'],
      governing: ['packages/app/tsconfig.json', 'tsconfig.json'],
      conditioned: [],
      mapped: [],
      based: [],
    });
  });

  it('names a config by what it inherits, and not one that clears it', async () => {
    const root = await workspace({
      'tsconfig.base.json': WITH,
      'packages/app/tsconfig.json': '{ "extends": "../../tsconfig.base.json" }',
      'packages/lib/tsconfig.json': '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "customConditions": [] } }',
    });

    expect((await tsconfigUse(root)).conditioned).toEqual(['packages/app/tsconfig.json', 'tsconfig.base.json']);
  });

  it('names a config that maps paths, by what it inherits', async () => {
    const root = await workspace({
      'tsconfig.base.json': JSON.stringify({ compilerOptions: { paths: { '~lib': [TARGET] } } }),
      'packages/app/tsconfig.json': '{ "extends": "../../tsconfig.base.json" }',
    });

    expect(await tsconfigUse(root)).toMatchObject({ conditioned: [], mapped: ['packages/app/tsconfig.json', 'tsconfig.base.json'] });
  });

  it('names a config that sets baseUrl alone, by what it inherits, since a bare specifier resolves through it', async () => {
    const root = await workspace({
      'tsconfig.base.json': JSON.stringify({ compilerOptions: { baseUrl: 'src' } }),
      'packages/app/tsconfig.json': '{ "extends": "../../tsconfig.base.json" }',
    });

    expect(await tsconfigUse(root)).toMatchObject({ mapped: [], based: ['packages/app/tsconfig.json', 'tsconfig.base.json'] });
  });

  it('reads what the listing holds, so not an ignored config, and names the declared config from the root', async () => {
    const root = await workspace({ 'tsconfig.app.json': WITHOUT, 'variance.config.json': declaring({ tsconfig: 'tsconfig.app.json' }) });
    await writeFile(join(root, '.gitignore'), 'tsconfig.json\n');
    await writeFile(join(root, 'tsconfig.json'), WITH);

    expect(await tsconfigUse(join(root, 'packages/app'))).toEqual({
      declared: 'tsconfig.app.json',
      under: 'packages/app',
      configs: ['tsconfig.app.json'],
      governing: ['tsconfig.app.json'],
      conditioned: [],
      mapped: [],
      based: [],
    });
  });

  it('reads the named config though the listing does not hold it, and names it as governing every directory', async () => {
    const paths = JSON.stringify({ compilerOptions: { paths: { '~lib': [TARGET] } } });
    const root = await workspace({ 'config/aliases.json': paths, 'variance.config.json': declaring({ tsconfig: 'config/aliases.json' }) });

    expect(await tsconfigUse(join(root, 'packages/app'))).toMatchObject({
      declared: 'config/aliases.json',
      configs: ['config/aliases.json'],
      governing: ['config/aliases.json'],
      mapped: ['config/aliases.json'],
    });
  });

  it('reads every config the repository holds, and names apart those that can govern the directory asked', async () => {
    const lib = JSON.stringify({ compilerOptions: { paths: { '~lib': ['src'] } } });
    const root = await workspace({
      'tsconfig.json': WITHOUT,
      'packages/tsconfig.base.json': WITHOUT,
      'packages/app/tsconfig.json': WITHOUT,
      'packages/app/src/tsconfig.json': WITHOUT,
      'packages/lib/tsconfig.json': lib,
    });

    expect(await tsconfigUse(join(root, 'packages/app'))).toMatchObject({
      configs: ['packages/app/src/tsconfig.json', 'packages/app/tsconfig.json', 'packages/lib/tsconfig.json', 'packages/tsconfig.base.json', 'tsconfig.json'],
      governing: ['packages/app/src/tsconfig.json', 'packages/app/tsconfig.json', 'packages/tsconfig.base.json', 'tsconfig.json'],
      mapped: ['packages/lib/tsconfig.json'],
    });
  });

  it('lists no config outside a git checkout, rather than an empty list', async () => {
    const root = realPath(await mkdtemp(join(tmpdir(), 'variance-typescript-plain-')));
    roots.push(root);
    await writeFile(join(root, 'tsconfig.json'), WITH);

    expect(await tsconfigUse(root)).toEqual({ declared: undefined, under: '', conditioned: [], mapped: [], based: [] });
  });

  it('says false when the root config turns the tsconfig off', async () => {
    const root = await workspace({ 'tsconfig.json': WITH, 'variance.config.json': declaring({ tsconfig: false }) });

    expect(await tsconfigUse(root)).toMatchObject({ declared: false, conditioned: ['tsconfig.json'] });
  });
});
