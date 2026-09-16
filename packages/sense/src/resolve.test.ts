import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { realPath, resolveTo, resolversFor } from './resolve.js';
import { scanRelations } from './scan.js';

/**
 * Which project a file belongs to, decided from the file rather than the
 * directory it sits in.
 *
 * A specifier is resolved against a `tsconfig`, and which config that is has to
 * be found without anyone naming it. Both halves below are about getting that
 * wrong quietly: a scan that never finds the config reports the alias as
 * unresolved, and a scan that finds the wrong one reports a confident edge to a
 * real file the specifier does not name. Only the first of those is counted
 * anywhere, which is why the second is tested against a resolver with an empty
 * memo — the only ground truth available.
 */

describe('resolving through a tsconfig nobody named', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-paths-'));

    // The shape every monorepo has: `paths` declared once at the root, and a
    // package `tsconfig` that only extends it. Nothing here is unusual, and
    // nothing here is configured — `tsconfig` is left at its default.
    await write(root, 'package.json', '{ "name": "fixture", "type": "module" }');
    await write(root, 'tsconfig.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "@fixture/*": ["packages/*/src"] } } }');
    await write(root, 'packages/ui/tsconfig.json', '{ "extends": "../../tsconfig.json" }');
    await write(root, 'packages/ui/src/index.ts', "import { clamp } from '@fixture/util';\nexport const Ui = () => clamp(1);");
    await write(root, 'packages/util/src/index.ts', 'export const clamp = (n: number) => n;');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finds the alias without being told where the config is', async () => {
    const records = await scanRelations({ root, dirs: ['packages'] });
    const ui = records.find((record) => record.file === 'packages/ui/src/index.ts');

    // The default is `auto`, which means "walk up from the importing file until
    // a `tsconfig` turns up". Handed a directory instead of that file, the
    // resolver has nothing to walk up from and quietly behaves as though no
    // config existed — and a bare specifier that resolves to nothing is not a
    // hole, so the edge simply is not there and no error says so.
    expect(ui?.edges).toEqual([{ to: 'packages/util/src/index.ts', kind: 'imports' }]);
    expect(ui?.unresolved).toBeUndefined();
  });

  it('agrees with the same config named explicitly', async () => {
    const found = await scanRelations({ root, dirs: ['packages'] });
    const told = await scanRelations({ root, dirs: ['packages'], tsconfig: join(root, 'tsconfig.json') });

    // Naming the root config was the workaround while discovery was broken.
    // It has to stop being a difference, or the workaround is still the fix.
    expect(found).toEqual(told);
  });
});

/**
 * One directory, two configs, and a memo that has to tell them apart.
 *
 * A directory is the wrong unit for a resolution and a solution-style build is
 * where that stops being pedantry: the project governing a file is chosen by
 * matching the file against each reference's `include` and `exclude`, which is a
 * filename test, so one `src` can hold files under `paths` tables that disagree.
 * The damage is not a missing edge — those are counted and reported — but a
 * confident wrong one, to a real file in this repository that the specifier does
 * not name, chosen by whichever file the walk reached first.
 */
describe('two files in one directory under configs that disagree', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-projects-'));

    // The layout `tsc --build` is for: a root config that compiles nothing and
    // only names its references, and one project per half of `src`. Splitting
    // app from spec by filename is the ordinary way to give tests their own
    // aliases without a second source tree.
    await write(root, 'package.json', '{ "name": "fixture", "type": "module" }');
    await write(root, 'tsconfig.json', '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }, { "path": "./tsconfig.spec.json" }] }');
    await write(root, 'tsconfig.app.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "@fixture/target": ["src/app-target.ts"] } }, "include": ["src/**/*.ts"], "exclude": ["src/**/*.test.ts"] }');
    await write(root, 'tsconfig.spec.json', '{ "compilerOptions": { "baseUrl": ".", "paths": { "@fixture/target": ["src/spec-target.ts"] } }, "include": ["src/**/*.test.ts"] }');

    // The same specifier, spelled the same way, correct in both files, and
    // pointing somewhere different in each.
    await write(root, 'src/widget.ts', "import { target } from '@fixture/target';\nexport const widget = target;");
    await write(root, 'src/widget.test.ts', "import { target } from '@fixture/target';\nexport const spec = target;");
    await write(root, 'src/app-target.ts', 'export const target = 1;');
    await write(root, 'src/spec-target.ts', 'export const target = 2;');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('gives each file the target its own project names', async () => {
    const records = await scanRelations({ root, dirs: ['src'] });
    const edgesOf = (file: string) => records.find((record) => record.file === file)?.edges;

    // Both are asserted because only one of them is wrong under a directory key
    // and nothing in the repository decides which: it is the order the walk
    // happened to list a directory in. Asserting either one alone is a test that
    // passes on half the machines it runs on.
    expect(edgesOf('src/widget.ts')).toEqual([{ to: 'src/app-target.ts', kind: 'imports' }]);
    expect(edgesOf('src/widget.test.ts')).toEqual([{ to: 'src/spec-target.ts', kind: 'imports' }]);
  });

  it('agrees with each file asked on its own', async () => {
    // The real path because resolution returns one, and on macOS a temporary
    // directory is reached through a link that would put every answer outside
    // the repository.
    const real = realPath(root);
    const alone = (file: string) =>
      resolveTo({
        resolvers: resolversFor({}),
        root: real,
        from: join(real, file),
        request: '@fixture/target',
        style: false,
      });

    // A resolver with an empty memo is the only ground truth available — it
    // cannot have been handed anything. Sharing one is an optimisation, and an
    // optimisation that changes an answer is not one.
    expect(alone('src/widget.ts')).toBe('src/app-target.ts');
    expect(alone('src/widget.test.ts')).toBe('src/spec-target.ts');
  });
});

async function write(root: string, path: string, contents: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${contents}\n`, 'utf8');
}
