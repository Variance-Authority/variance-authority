import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPublishedSources, updateSourceIndex } from './published.js';

/**
 * A configuration file is a file (#1523): its edit rebuilds its own record and
 * no other, and each real workflow that edits configuration together with the
 * code that uses it lands on the answers a cold index of the edited tree gives.
 *
 * The fixture is a committed Git checkout of a two-package workspace, because
 * reuse is keyed by the digests Git holds. Each edit is committed, as a pull or
 * a branch switch brings it.
 */

const made: string[] = [];

afterEach(async () => {
  for (const path of made.splice(0)) await rm(path, { recursive: true, force: true });
});

interface Checkout {
  readonly root: string;
  write(file: string, text: string): Promise<void>;
  remove(file: string): Promise<void>;
  commit(): void;
  /** Updates the warm index and says how many files it read again. */
  update(): Promise<number>;
  /** The warm index's records, and a cold index's of the same tree. */
  answers(): Promise<{ readonly warm: unknown; readonly cold: unknown }>;
}

async function checkout(): Promise<Checkout> {
  const root = await mkdtemp(join(tmpdir(), 'variance-config-reuse-'));
  const cache = await mkdtemp(join(tmpdir(), 'variance-config-reuse-index-'));
  made.push(root, cache);
  const warm = join(cache, 'warm.index');
  let colds = 0;
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root });
  };
  const write = async (file: string, text: string): Promise<void> => {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  };
  const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

  await write('.gitignore', 'node_modules\n');
  await write('package.json', json({ name: 'workspace', private: true, workspaces: ['packages/*'] }));
  await write('yarn.lock', '# yarn lockfile v1\n\nleft-pad@1.3.0:\n  version "1.3.0"\n');
  await write('tsconfig.base.json', json({ compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['packages/lib/src/*'] } } }));
  await write('tsconfig.json', json({ extends: './tsconfig.base.json' }));
  await write('packages/lib/package.json', json({ name: 'lib', main: './src/index.ts', exports: { '.': './src/index.ts', './util': './src/util.ts' } }));
  await write('packages/lib/tsconfig.json', json({ extends: '../../tsconfig.json' }));
  await write('packages/lib/src/index.ts', "export const lib = 1;\n");
  await write('packages/lib/src/util.ts', "export const util = 2;\n");
  await write('packages/app/package.json', json({ name: 'app', dependencies: { lib: '*', 'left-pad': '1.3.0' } }));
  await write('packages/app/tsconfig.json', json({ extends: '../../tsconfig.json' }));
  await write('packages/app/src/main.ts', "import { lib } from 'lib';\nimport { util } from 'lib/util';\nimport { other } from './other.js';\nexport const main = lib + util + other;\n");
  await write('packages/app/src/other.ts', "import { util } from '@lib/util';\nexport const other = util;\n");
  await write('packages/app/src/pad.ts', "import pad from 'left-pad';\nexport const padded = pad;\n");
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await symlink(join(root, 'packages/lib'), join(root, 'node_modules/lib'));
  await symlink(join(root, 'packages/app'), join(root, 'node_modules/app'));
  await write('node_modules/left-pad/package.json', json({ name: 'left-pad', version: '1.3.0', main: 'index.js' }));
  await write('node_modules/left-pad/index.js', 'module.exports = (s) => s;\n');
  git('init', '--quiet');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');
  await updateSourceIndex(root, { index: warm });

  return {
    root,
    write,
    remove: (file) => unlink(join(root, file)),
    commit() {
      git('add', '-A');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'edit');
    },
    update: async () => (await updateSourceIndex(root, { index: warm })).reread,
    async answers() {
      const cold = join(cache, `cold-${colds++}.index`);
      await updateSourceIndex(root, { index: cold });
      return {
        warm: (await readPublishedSources(warm)).records,
        cold: (await readPublishedSources(cold)).records,
      };
    },
  };
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

describe('a configuration edit, warm', () => {
  it('rebuilds only its own records for a description and a noEmit', async () => {
    const at = await checkout();
    await at.write('packages/app/package.json', json({ name: 'app', description: 'the app', dependencies: { lib: '*', 'left-pad': '1.3.0' } }));
    await at.write('packages/app/tsconfig.json', json({ extends: '../../tsconfig.json', compilerOptions: { noEmit: true } }));
    at.commit();

    // Neither file is a record the index holds, so nothing is read again.
    expect(await at.update()).toBe(0);
    const { warm, cold } = await at.answers();
    expect(warm).toEqual(cold);
  });

  it('answers as a cold index after a paths entry is added and files are refactored to it', async () => {
    const at = await checkout();
    await at.write('tsconfig.base.json', json({ compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['packages/lib/src/*'], '@app/*': ['packages/app/src/*'] } } }));
    await at.write('packages/app/src/main.ts', "import { lib } from 'lib';\nimport { util } from 'lib/util';\nimport { other } from '@app/other';\nexport const main = lib + util + other;\n");
    at.commit();

    expect(await at.update()).toBe(1);
    const { warm, cold } = await at.answers();
    expect(warm).toEqual(cold);
  });

  it('answers as a cold index after a module moves inside a package with its exports target', async () => {
    const at = await checkout();
    await at.remove('packages/lib/src/util.ts');
    await at.write('packages/lib/src/tools/util.ts', 'export const util = 2;\n');
    await at.write('packages/lib/package.json', json({ name: 'lib', main: './src/index.ts', exports: { '.': './src/index.ts', './util': './src/tools/util.ts' } }));
    await at.write('tsconfig.base.json', json({ compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['packages/lib/src/*', 'packages/lib/src/tools/*'] } } }));
    at.commit();

    await at.update();
    const { warm, cold } = await at.answers();
    expect(warm).toEqual(cold);
  });

  it("answers as a cold index after a pull moves a package's main with the module", async () => {
    const at = await checkout();
    await at.remove('packages/lib/src/index.ts');
    await at.write('packages/lib/src/entry/index.ts', 'export const lib = 1;\n');
    await at.write('packages/lib/package.json', json({ name: 'lib', main: './src/entry/index.ts', exports: { '.': './src/entry/index.ts', './util': './src/util.ts' } }));
    at.commit();

    await at.update();
    const { warm, cold } = await at.answers();
    expect(warm).toEqual(cold);
  });

  it('answers as a cold index after a pull changes what a tsconfig extends', async () => {
    const at = await checkout();
    await at.write('tsconfig.paths.json', json({ compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['packages/lib/src/*'] } } }));
    await at.write('packages/app/tsconfig.json', json({ extends: '../../tsconfig.paths.json' }));
    at.commit();

    // The new file moves the root's listing, and only what witnessed it is read again.
    expect(await at.update()).toBeLessThan(5);
    const { warm, cold } = await at.answers();
    expect(warm).toEqual(cold);
  });

  it('answers as a cold index after a workspace package is added and imported', async () => {
    const at = await checkout();
    await at.write('packages/kit/package.json', json({ name: 'kit', main: './src/index.ts' }));
    await at.write('packages/kit/src/index.ts', 'export const kit = 3;\n');
    await symlink(join(at.root, 'packages/kit'), join(at.root, 'node_modules/kit'));
    await at.write('packages/app/package.json', json({ name: 'app', dependencies: { lib: '*', kit: '*', 'left-pad': '1.3.0' } }));
    await at.write('packages/app/src/other.ts', "import { util } from '@lib/util';\nimport { kit } from 'kit';\nexport const other = util + kit;\n");
    at.commit();

    await at.update();
    const { warm, cold } = await at.answers();
    expect(warm).toEqual(cold);
  });

  it('reads nothing again after a dependency version is bumped in a manifest and the lock file', async () => {
    const at = await checkout();
    await at.write('packages/app/package.json', json({ name: 'app', dependencies: { lib: '*', 'left-pad': '1.3.1' } }));
    await at.write('yarn.lock', '# yarn lockfile v1\n\nleft-pad@1.3.1:\n  version "1.3.1"\n');
    await at.write('node_modules/left-pad/package.json', json({ name: 'left-pad', version: '1.3.1', main: 'index.js' }));
    at.commit();

    // An installed package is answered by its name, which the bump does not move.
    expect(await at.update()).toBe(0);
    const { warm, cold } = await at.answers();
    expect(warm).toEqual(cold);
  });

  it('answers as a cold index after the base tsconfig is deleted and its alias users are refactored', async () => {
    const at = await checkout();
    await at.remove('tsconfig.base.json');
    await at.write('tsconfig.json', json({}));
    await at.write('packages/app/src/other.ts', "import { util } from 'lib/util';\nexport const other = util;\n");
    at.commit();

    await at.update();
    const { warm, cold } = await at.answers();
    expect(warm).toEqual(cold);
  });

  it('reads nothing again when the base tsconfig stops reading, and what it did not map answers as cold', async () => {
    const at = await checkout();
    await at.write('tsconfig.base.json', '{ "compilerOptions": { "paths": ');
    at.commit();

    // A tsconfig is no record, and its bytes are no key: an edit mid-way through it costs nothing.
    expect(await at.update()).toBe(0);
    const { warm, cold } = await at.answers();
    // A file that imports through the broken mapping keeps its answer until it is edited, as the
    // refactor that removes a mapping edits it; every other file answers as a cold index does.
    const unmapped = (records: unknown): unknown =>
      (records as { file: string }[]).filter((record) => record.file !== 'packages/app/src/other.ts');
    expect(unmapped(warm)).toEqual(unmapped(cold));
  });
});
