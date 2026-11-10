import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { updateSourceIndex } from './published.js';
import { realPath } from './resolve.js';
import { openSourceIndexFile } from './source-index-file.js';
import { sourceIndexPath } from './source-index.js';
import { CACHE_VARIABLE } from './test-selection/cache-layers.js';

/**
 * Which checkouts one parse store answers: a worktree reads its primary
 * checkout's store from wherever in it a scan starts, and a checkout never
 * takes a parse of bytes other than the ones it reads.
 */
describe('the checkouts a parse store answers', () => {
  const made: string[] = [];
  const before = process.env[CACHE_VARIABLE];

  afterEach(() => {
    if (before === undefined) delete process.env[CACHE_VARIABLE];
    else process.env[CACHE_VARIABLE] = before;
  });

  afterAll(async () => {
    for (const path of made) await rm(path, { recursive: true, force: true });
  });

  async function temporary(prefix: string): Promise<string> {
    const path = realPath(await mkdtemp(join(tmpdir(), prefix)));
    made.push(path);
    return path;
  }

  async function write(root: string, file: string, text: string): Promise<void> {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }

  function git(root: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, stdio: 'ignore' });
  }

  async function records(root: string): Promise<string> {
    const file = await openSourceIndexFile(sourceIndexPath(root));
    return JSON.stringify([...file.stored.records].sort((left, right) => (left[0] < right[0] ? -1 : 1)));
  }

  /** A workspace whose `packages/a/src/entry.ts` imports `./<target>.js`, committed through `setup`. */
  async function checkout(target: string, setup: (root: string) => Promise<void> = async () => {}): Promise<string> {
    const root = await temporary('variance-parse-store-checkout-');
    await write(root, 'package.json', '{ "name": "fixture", "private": true, "workspaces": ["packages/*"] }');
    await write(root, 'packages/a/package.json', '{ "name": "@fixture/a" }');
    await write(root, 'packages/a/src/entry.ts', `import { side } from './${target}.js';\nexport const entry = side;\n`);
    await write(root, 'packages/a/src/left.ts', 'export const side = 1;\n');
    await write(root, 'packages/a/src/right.ts', 'export const side = 2;\n');
    git(root, 'init', '--quiet');
    await setup(root);
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'fixture');
    return root;
  }

  it('parses nothing again for a directory of a worktree, under the default cache locations', async () => {
    delete process.env[CACHE_VARIABLE];
    const root = await checkout('left');
    await updateSourceIndex(root);
    const second = join(await temporary('variance-parse-store-worktree-'), 'second');
    git(root, 'worktree', 'add', '--quiet', second);

    const part = await updateSourceIndex(join(second, 'packages/a'));
    expect(part.files).toBeGreaterThan(0);
    expect(part.parsed).toBe(0);
  });

  it("takes no parse of another checkout's bytes that a clean filter makes the same blob", async () => {
    // The filter cleans every `entry.ts` to one blob, so the two checkouts' blobs
    // are the same object while the files on disk import different modules.
    const filtered = async (root: string) => {
      await write(root, '.gitattributes', 'entry.ts filter=same\n');
      git(root, 'config', 'filter.same.clean', "cat >/dev/null; printf 'export const entry = 0;\\n'");
      git(root, 'config', 'filter.same.smudge', 'cat');
    };
    const left = await checkout('left', filtered);
    const right = await checkout('right', filtered);

    process.env[CACHE_VARIABLE] = await temporary('variance-parse-store-alone-');
    await updateSourceIndex(right);
    const alone = await records(right);

    process.env[CACHE_VARIABLE] = await temporary('variance-parse-store-shared-');
    await updateSourceIndex(left);
    await updateSourceIndex(right);
    expect(await records(right)).toBe(alone);
  });
});
