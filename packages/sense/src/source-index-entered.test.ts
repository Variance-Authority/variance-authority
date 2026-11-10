import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readPublishedSources, updateSourceIndex } from './published.js';
import { scanRelations } from './scan.js';

/**
 * A repository's parses are read once, whichever way it is entered.
 *
 * A parse is keyed by the bytes it came from, so a scan started in a
 * subdirectory or in a worktree's subdirectory asks
 * for parses the cache already holds. Reading any of them again is a miss the
 * cache had the answer to.
 */

describe('a source index entered from elsewhere in its repository', () => {
  let root: string;
  let cache: string;
  let held: string | undefined;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-entered-'));
    await write('package.json', '{ "name": "fixture" }');
    await write('.gitignore', 'node_modules\n');
    await write('app/index.ts', "import { unit } from '../lib/unit.js';\nexport const app = unit;\n");
    await write('lib/unit.ts', 'export const unit = 1;\n');
    await write('lib/alone.ts', 'export const alone = 2;\n');
    // A workspace package nobody built: its export names `dist/`, which only
    // its `tsconfig` maps back to `src/`.
    await write('packages/lib/package.json', '{ "name": "@acme/lib", "exports": "./dist/index.js" }');
    await write('packages/lib/tsconfig.json', '{ "compilerOptions": { "rootDir": "src", "outDir": "dist" } }');
    await write('packages/lib/src/index.ts', 'export const lib = 1;\n');
    await write('packages/app/package.json', '{ "name": "@acme/app", "dependencies": { "@acme/lib": "*" } }');
    await write('packages/app/src/main.ts', "import { lib } from '@acme/lib';\nexport const main = lib;\n");
    await mkdir(join(root, 'node_modules/@acme'), { recursive: true });
    await symlink(join(root, 'packages/lib'), join(root, 'node_modules/@acme/lib'));
    git('init', '--quiet');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    cache = await mkdtemp(join(tmpdir(), 'variance-entered-cache-'));
    held = process.env['VARIANCE_AUTHORITY_CACHE'];
    process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  });

  afterEach(async () => {
    if (held === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
    else process.env['VARIANCE_AUTHORITY_CACHE'] = held;
    await rm(cache, { recursive: true, force: true });
  });

  async function write(file: string, text: string): Promise<void> {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }

  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: root });
  }

  it('reads nothing again for a scan started in a subdirectory, and keeps it under the repository', async () => {
    const whole = await updateSourceIndex(root);
    const lib = join(root, 'lib');

    const first = await updateSourceIndex(lib);
    expect(first).toMatchObject({ was: 'missing', files: 2, reread: 0 });
    expect(relative(dirname(whole.path), first.path)).not.toMatch(/^\.\./u);
    expect((await readPublishedSources(first.path)).records)
      .toEqual(await scanRelations({ root: lib, dirs: ['.'] }));
    expect(await updateSourceIndex(lib)).not.toHaveProperty('from');
  });

  it("reads only what differs for a scan started in a worktree's subdirectory", async () => {
    const worktree = join(cache, 'worktree');
    await updateSourceIndex(root);
    git('worktree', 'add', '--quiet', '--detach', worktree);
    try {
      await writeFile(join(worktree, 'lib/alone.ts'), 'export const alone = 3;\n');
      const lib = join(worktree, 'lib');

      expect(await updateSourceIndex(lib)).toMatchObject({ was: 'missing', files: 2, reread: 1 });
    } finally {
      git('worktree', 'remove', '--force', worktree);
    }
  });

  it('resolves a held parse as a fresh scan does, through an unbuilt workspace package', async () => {
    await updateSourceIndex(root);
    const packages = join(root, 'packages');

    const entered = await updateSourceIndex(packages);
    expect(entered).toMatchObject({ was: 'missing', reread: 0 });
    const records = (await readPublishedSources(entered.path)).records;
    expect(records.find((record) => record.file === 'app/src/main.ts'))
      .toMatchObject({ edges: [{ to: 'lib/src/index.ts' }] });
    expect(records).toEqual(await scanRelations({ root: packages, dirs: ['.'] }));
  });
});
