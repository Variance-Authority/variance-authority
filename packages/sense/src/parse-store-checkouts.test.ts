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
    const sorted = (entries: Iterable<[string, unknown]>) => [...entries].sort((left, right) => (left[0] < right[0] ? -1 : 1));
    return JSON.stringify([sorted(file.stored.records), sorted(file.stored.parses)]);
  }

  /** A workspace whose package `a` holds an `entry.ts` importing `./<target>.js`, committed through `setup`. */
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
    // Only the parses are shared: the directory's own index stays in the worktree.
    expect(sourceIndexPath(join(second, 'packages/a')).startsWith(`${second}/`)).toBe(true);
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

  // A wave this small is read off the disk, and each file's bytes are told from its blob as they are read.
  it('parses nothing again for a checkout of blobs another read off the disk', async () => {
    process.env[CACHE_VARIABLE] = await temporary('variance-parse-store-shared-');
    await updateSourceIndex(await checkout('left'));
    const second = await updateSourceIndex(await checkout('left'));
    expect(second.files).toBeGreaterThan(0);
    expect(second.parsed).toBe(0);
  });

  // `packs: false` is the update made in JavaScript, which fills the store from the index it wrote.
  it.each([{}, { packs: false }])('takes no parse another checkout made of bytes it edited after git named them, updating with %o', async (options) => {
    // `edited` holds bytes git still names by the committed blob. Git was told not to
    // look for the edit, as it has not looked for one made after it listed the tree.
    const edited = await checkout('left');
    const clean = await checkout('left');
    git(edited, 'update-index', '--assume-unchanged', 'packages/a/src/entry.ts');
    await write(edited, 'packages/a/src/entry.ts', "import { side } from './right.js';\nexport const entry = side;\n");

    process.env[CACHE_VARIABLE] = await temporary('variance-parse-store-alone-');
    await updateSourceIndex(clean);
    const alone = await records(clean);

    process.env[CACHE_VARIABLE] = await temporary('variance-parse-store-shared-');
    await updateSourceIndex(edited, options);
    await updateSourceIndex(clean);
    expect(await records(clean)).toBe(alone);
  });

  // Paths of one blob share one parse key, so a clean read of one must not vouch for the others.
  it.each(['first', 'last'] as const)('takes no parse of an edited file whose blob another path holds unedited, the %s one', async (unedited) => {
    const twins = Array.from({ length: 40 }, (_, at) => `packages/a/src/twin-${String(at).padStart(2, '0')}.ts`);
    const text = (target: string) => `import { side } from './${target}.js';\nexport const twin = side;\n`;
    const twinned = async (root: string) => { for (const twin of twins) await write(root, twin, text('left')); };
    const edited = await checkout('left', twinned);
    const clean = await checkout('left', twinned);
    for (const twin of unedited === 'first' ? twins.slice(1) : twins.slice(0, -1)) {
      git(edited, 'update-index', '--assume-unchanged', twin);
      await write(edited, twin, text('right'));
    }

    process.env[CACHE_VARIABLE] = await temporary('variance-parse-store-alone-');
    await updateSourceIndex(clean);
    const alone = await records(clean);

    process.env[CACHE_VARIABLE] = await temporary('variance-parse-store-shared-');
    await updateSourceIndex(edited);
    await updateSourceIndex(clean);
    expect(await records(clean)).toBe(alone);
  });

  it("takes no parse of another checkout's line endings that `core.eol=crlf` writes out of one blob", async () => {
    await expectOwnLineEndings('core.eol', 'crlf');
  });

  // Git reads any nonzero number as true, so each of these writes CRLF.
  it.each(['2', '-1', '01'])("takes no parse of another checkout's line endings that `core.autocrlf=%s` writes out of one blob", async (value) => {
    await expectOwnLineEndings('core.autocrlf', value);
  });

  /** An LF checkout fills a shared store, then a checkout git writes with CRLF under `key=value` reads as it reads alone. */
  async function expectOwnLineEndings(key: string, value: string): Promise<void> {
    // `text=auto` keeps LF in the blob; the setting writes the crlf checkout's
    // files with CRLF once git checks them out again.
    const text = async (root: string) => write(root, '.gitattributes', '* text=auto\n');
    const lf = await checkout('left', text);
    const crlf = await checkout('left', text);
    git(crlf, 'config', key, value);
    git(crlf, 'rm', '--quiet', '--cached', '-r', '.');
    git(crlf, 'reset', '--quiet', '--hard');

    process.env[CACHE_VARIABLE] = await temporary('variance-parse-store-alone-');
    await updateSourceIndex(crlf);
    const alone = await records(crlf);

    process.env[CACHE_VARIABLE] = await temporary('variance-parse-store-shared-');
    await updateSourceIndex(lf);
    await updateSourceIndex(crlf);
    expect(await records(crlf)).toBe(alone);
  }
});
