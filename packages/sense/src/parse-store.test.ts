import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseStorePath, pruneParseStore } from './parse-store.js';
import { updateSourceIndex } from './published.js';
import { realPath } from './resolve.js';
import { openSourceIndexFile } from './source-index-file.js';
import { sourceIndexPath } from './source-index.js';
import { CACHE_VARIABLE } from './test-selection/cache-layers.js';

/**
 * A parse is a function of the bytes and the way they are read, so one read
 * anywhere in a cache answers every root that reads the same bytes: the
 * checkout, a directory in it, a worktree. Each case counts the modules an
 * update parsed, which is what the store exists to save.
 */
describe('the parse store a cache keeps', () => {
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

  it('parses nothing again for a directory of a checkout the cache has read', async () => {
    const root = await checkout();
    const whole = await updateSourceIndex(root);
    expect(whole.parsed).toBeGreaterThan(0);

    const part = await updateSourceIndex(join(root, 'packages/a'));
    expect(part.files).toBeGreaterThan(0);
    expect(part.parsed).toBe(0);
  });

  it('parses nothing again for a directory of a second worktree that holds the same bytes', async () => {
    const root = await checkout();
    await updateSourceIndex(root);
    const second = join(await temporary('variance-parse-store-worktree-'), 'second');
    git(root, 'worktree', 'add', '--quiet', second);

    const part = await updateSourceIndex(join(second, 'packages/b'));
    expect(part.files).toBeGreaterThan(0);
    expect(part.parsed).toBe(0);
  });

  it('parses nothing again for a directory whose modules reach a file only a full read takes', async () => {
    const root = await checkout();
    await write(root, 'packages/a/src/look.css', '.lens { color: red; }\n');
    await write(root, 'packages/a/src/index.ts', "import { lens } from './lens.js';\nimport './look.css';\nexport const a = lens;\n");
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'look');
    await updateSourceIndex(root);

    const steps: string[] = [];
    const part = await updateSourceIndex(join(root, 'packages/a'), { progress: (step) => { steps.push(step); return () => {}; } });
    expect(steps.some((step) => step.startsWith('reading every file'))).toBe(true);
    expect(part.files).toBeGreaterThan(0);
    expect(part.parsed).toBe(0);
  });

  it('parses nothing again when the roots that read before it are of different generations', async () => {
    const root = await checkout();
    // An older root: it read `lens.ts` before the edit below.
    await updateSourceIndex(join(root, 'packages'));
    await write(root, 'packages/a/src/lens.ts', 'export const lens = 3;\n');
    git(root, 'commit', '--quiet', '-am', 'edit');
    // A newer root: it read the edited bytes.
    await updateSourceIndex(root);

    const fresh = await updateSourceIndex(join(root, 'packages/a'));
    expect(fresh.files).toBeGreaterThan(0);
    expect(fresh.parsed).toBe(0);
  });

  it('answers a stored parse with the edges a fresh parse resolves, through a workspace that was never built', async () => {
    const root = await checkout();
    // `@fixture/lib` publishes `./dist/index.js`, and there is no `dist`: the
    // edge reaches `src/index.ts` only through the resolver that maps one to the other.
    await write(root, 'packages/lib/package.json', JSON.stringify({
      name: '@fixture/lib',
      exports: { '.': './dist/index.js' },
    }));
    await write(root, 'packages/lib/src/index.ts', 'export const lib = 4;\n');
    await write(root, 'packages/a/src/uses.ts', "import { lib } from '@fixture/lib';\nexport const uses = lib;\n");
    await write(root, 'packages/a/src/index.ts', "import { lens } from './lens.js';\nimport { uses } from './uses.js';\nexport const a = lens + uses;\n");
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'lib');

    const fresh = await updateSourceIndex(root);
    const edges = await records(root);
    expect(edges).toContain('"packages":[{"to":"@fixture/lib","kind":"imports"}');

    // A second cache, whose store holds `packages/a`'s parses, read from a root that does not reach the workspace.
    process.env[CACHE_VARIABLE] = await temporary('variance-parse-store-second-cache-');
    await updateSourceIndex(join(root, 'packages/a'));
    const cached = await updateSourceIndex(root);
    expect(cached.parsed).toBeLessThan(fresh.parsed!);
    expect(await records(root)).toEqual(edges);
  });

  it('reclaims the parses only a removed root named, and keeps every one a standing root or a young write names', async () => {
    const root = await checkout();
    await updateSourceIndex(join(root, 'packages/a'));
    const named = new Set(await storedKeys());
    await updateSourceIndex(join(root, 'packages/b'));
    const all = await storedKeys();
    expect(all.length).toBeGreaterThan(named.size);

    await rm(dirname(sourceIndexPath(join(root, 'packages/b'))), { recursive: true, force: true });
    // Within the grace period nothing goes: a writer may not have published the root that names it yet.
    expect((await pruneParseStore(cache, { graceMs: 60 * 60 * 1000 })).dropped).toBe(0);
    expect(await storedKeys()).toEqual(all);

    const swept = await pruneParseStore(cache, { graceMs: 0 });
    expect(swept.dropped).toBe(all.length - named.size);
    expect(new Set(await storedKeys())).toEqual(named);
  });
});
