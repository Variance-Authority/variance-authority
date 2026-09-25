import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { customConditionsFor } from './conditions.js';
import { native, nativeAvailable } from './native.js';
import { realPath, resolveTo, resolversFor, type ResolveOptions } from './resolve.js';
import { scanRelations } from './scan.js';

/**
 * A workspace package that exports its source under a condition of its own.
 *
 * `@acme/lib` exports `./src/index.ts` under `@acme/source` and `./dist/index.js`
 * under `import`, and there is no `dist/`: the checkout holds source, and the
 * build is somebody else's step. TypeScript is told about the condition in
 * `customConditions`, which is the owner of what `@acme/lib` means here. A
 * resolver that does not read the option lands on the missing `dist/`, and the
 * edge from `app` to `lib` is not there — so a change to `lib` reaches nothing
 * in `app`, and no error says so.
 */

const IMPORTER = 'packages/app/src/index.ts';
const TARGET = 'packages/lib/src/index.ts';
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** The workspace, with `files` laid over it. */
async function workspace(files: Readonly<Record<string, string>>): Promise<string> {
  const root = realPath(await mkdtemp(join(tmpdir(), 'variance-conditions-')));
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
  return root;
}

const WITH = '{ "compilerOptions": { "customConditions": ["@acme/source"] } }';
const WITHOUT = '{ "compilerOptions": { "strict": true } }';

async function scanned(root: string, options: ResolveOptions = {}): Promise<readonly string[] | undefined> {
  const records = await scanRelations({ root, dirs: ['packages'], ...options });
  return records.find((record) => record.file === IMPORTER)?.edges?.map((edge) => edge.to);
}

function oracle(root: string, options: ResolveOptions = {}): string | undefined {
  return resolveTo({
    resolvers: resolversFor(options),
    root,
    from: join(root, IMPORTER),
    request: '@acme/lib',
    language: 'module',
  });
}

describe('a condition only the tsconfig names', () => {
  it('leaves the edge out when no tsconfig names it', async () => {
    const root = await workspace({ 'tsconfig.json': WITHOUT });

    expect(await scanned(root) ?? []).not.toContain(TARGET);
    expect(oracle(root)).toBeUndefined();
  });

  it('reaches the source the condition exports when the governing tsconfig names it', async () => {
    const root = await workspace({ 'tsconfig.json': WITH });

    expect(await scanned(root)).toContain(TARGET);
    expect(oracle(root)).toBe(TARGET);
  });

  it('inherits the option through extends', async () => {
    const root = await workspace({
      'tsconfig.base.json': WITH,
      'packages/app/tsconfig.json': '{ "extends": "../../tsconfig.base.json", "include": ["src"] }',
    });

    expect(await scanned(root)).toContain(TARGET);
    expect(oracle(root)).toBe(TARGET);
  });

  it('lets a child clear what it inherits with null or an empty list', async () => {
    for (const cleared of ['null', '[]']) {
      const root = await workspace({
        'tsconfig.json': WITH,
        'packages/app/tsconfig.json': `{ "extends": "../../tsconfig.json", "compilerOptions": { "customConditions": ${cleared} } }`,
      });

      expect(await scanned(root) ?? [], cleared).not.toContain(TARGET);
      expect(oracle(root), cleared).toBeUndefined();
    }
  });

  it('reads the option from a tsconfig the caller names', async () => {
    const root = await workspace({ 'tsconfig.json': WITHOUT, 'tsconfig.source.json': WITH });
    const named = { tsconfig: join(root, 'tsconfig.source.json') };

    expect(await scanned(root, named)).toContain(TARGET);
    expect(oracle(root, named)).toBe(TARGET);
  });

  it('keeps conditions a caller names as the whole set', async () => {
    const root = await workspace({ 'tsconfig.json': WITH });
    const named = { conditionNames: ['import', 'default'] };

    expect(await scanned(root, named) ?? []).not.toContain(TARGET);
    expect(oracle(root, named)).toBeUndefined();
  });

  it('takes the config that owns the file, not the nearest one', async () => {
    // `packages/app/tsconfig.json` owns only `lib/`, so `src/index.ts` answers
    // to the root config, which names the condition.
    const root = await workspace({
      'tsconfig.json': WITH,
      'packages/app/tsconfig.json': `{ "include": ["lib"], "compilerOptions": { "customConditions": [] } }`,
    });

    expect(customConditionsFor('auto')(join(root, IMPORTER))).toEqual(['@acme/source']);
    expect(await scanned(root)).toContain(TARGET);
  });
});

describe('the native scanner against the oracle, on custom conditions', () => {
  const cases: Record<string, Readonly<Record<string, string>>> = {
    without: { 'tsconfig.json': WITHOUT },
    with: { 'tsconfig.json': WITH },
    extended: {
      'tsconfig.base.json': WITH,
      'packages/app/tsconfig.json': '{ "extends": "../../tsconfig.base.json", "include": ["src"] }',
    },
    cleared: {
      'tsconfig.json': WITH,
      'packages/app/tsconfig.json': '{ "extends": "../../tsconfig.json", "compilerOptions": { "customConditions": null } }',
    },
    solution: {
      'tsconfig.json': '{ "files": [], "references": [{ "path": "./packages/app" }] }',
      'packages/app/tsconfig.json': '{ "extends": "../../tsconfig.base.json", "include": ["src"] }',
      'tsconfig.base.json': WITH,
    },
  };

  it.runIf(nativeAvailable()).each(Object.keys(cases))('agrees on %s', async (name) => {
    const root = await workspace(cases[name]!);
    const batch = native()!.scanBatch(root, [IMPORTER]);

    expect(batch.targets[0] ?? '').toBe(oracle(root) ?? '');
    expect(batch.targets[0] ?? '').toBe(name === 'without' || name === 'cleared' ? '' : TARGET);
  });
});
