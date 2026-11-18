/** Shared committed workspace and isolated cache for parse-store cases. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeEach } from 'vitest';
import { parseStorePath } from '../parse-store.js';
import { realPath } from '../resolve.js';
import { openSourceIndexFile } from './source-index-file.js';
import { sourceIndexPath } from '../source-index.js';
import { CACHE_VARIABLE } from '../test-selection/cache-layers.js';

export function parseStoreFixture() {
  const made: string[] = [];
  const before = process.env[CACHE_VARIABLE];
  let cache: string;

  beforeEach(async () => {
    cache = await temporary('variance-parse-store-cache-');
    process.env[CACHE_VARIABLE] = cache;
  });

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

  /** A workspace of two packages, committed. */
  async function checkout(): Promise<string> {
    const root = await temporary('variance-parse-store-');
    await write(root, 'package.json', '{ "name": "fixture", "private": true, "workspaces": ["packages/*"] }');
    await write(root, 'packages/a/package.json', '{ "name": "@fixture/a" }');
    await write(root, 'packages/a/src/index.ts', "import { lens } from './lens.js';\nexport const a = lens;\n");
    await write(root, 'packages/a/src/lens.ts', 'export const lens = 1;\n');
    await write(root, 'packages/b/package.json', '{ "name": "@fixture/b" }');
    await write(root, 'packages/b/src/index.ts', "import { only } from './only.js';\nexport const b = only;\n");
    await write(root, 'packages/b/src/only.ts', 'export const only = 2;\n');
    git(root, 'init', '--quiet');
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'fixture');
    return root;
  }

  async function records(root: string): Promise<string> {
    const file = await openSourceIndexFile(sourceIndexPath(root));
    return JSON.stringify([...file.stored.records].sort((left, right) => (left[0] < right[0] ? -1 : 1)));
  }

  async function storedKeys(): Promise<readonly string[]> {
    const file = await openSourceIndexFile(parseStorePath(cache));
    return [...file.stored.parses.keys()];
  }

  return { get cache() { return cache; }, temporary, write, git, checkout, records, storedKeys };
}
