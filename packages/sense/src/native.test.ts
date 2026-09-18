import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { nativeAvailable } from './native.js';
import { gitDigests, gitTreeOf, treeOf, type Tree } from './tree.js';

/**
 * The native tree and the JavaScript one, asked the same questions.
 *
 * The scanner in Rust is allowed to be a different program. It is not allowed to
 * be a different *answer*: a digest that disagrees is a file reported still, and
 * a directory digest that disagrees is a record kept that should have been
 * rebuilt. So the JavaScript implementation stays, and stays the oracle — these
 * tests run both over one repository and compare, rather than asserting what
 * either of them should have said.
 *
 * The corpus is the working tree disagreeing with `HEAD` in every way it can:
 * clean, edited, staged, untracked, deleted, renamed, nested, and non-ASCII.
 */

const run = promisify(execFile);
const native = nativeAvailable();

describe('the native tree against the JavaScript one', () => {
  const made: string[] = [];

  afterAll(async () => {
    for (const dir of made) await rm(dir, { recursive: true, force: true });
  });

  async function repository(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'variance-native-'));
    made.push(root);

    await write(root, 'package.json', '{ "name": "corpus" }\n');
    await write(root, 'tsconfig.json', '{ "compilerOptions": { "baseUrl": "." } }\n');
    await write(root, 'yarn.lock', '# one\n');
    await write(root, 'src/Button.tsx', 'export function Button() { return null }\n');
    await write(root, 'src/tokens.css', ':root { --accent: rebeccapurple }\n');
    await write(root, 'src/panel/Panel.tsx', 'export const Panel = () => null\n');
    await write(root, 'src/panel/deep/nested/leaf.ts', 'export const leaf = 1\n');
    await write(root, 'src/café/über.ts', 'export const naming = 1\n');
    // U+1F600 sorts *before* U+FF5E in UTF-16 code units and after it in UTF-8
    // bytes, so these two catch an ordering that walks bytes rather than units.
    await write(root, 'src/\u{1F600}.ts', 'export const grin = 1\n');
    await write(root, 'src/\uFF5E.ts', 'export const wide = 1\n');
    await write(root, 'docs/readme.md', 'one\n');

    await git(root, ['init', '--quiet']);
    await git(root, ['add', '-A']);
    await git(root, ['commit', '--quiet', '-m', 'one']);

    return root;
  }

  /** Every question a scan asks, as one comparable value. */
  function asked(tree: Tree): unknown {
    const paths = [...tree.paths()];

    return {
      size: tree.size,
      paths,
      digests: paths.map((path) => tree.get(path)),
      named: [...tree.named(['package.json', 'jsconfig.json', 'yarn.lock'])],
      directories: [...tree.directories()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
      bounded: tree.configDigest(['version 2', `root x`], ['package.json'], false),
      unbounded: tree.configDigest(['version 2', `root x`], ['package.json'], true),
    };
  }

  async function both(root: string): Promise<{ oracle: unknown; answered: unknown }> {
    const digests = await gitDigests(root);
    expect(digests).toBeDefined();

    return { oracle: asked(treeOf(digests!)), answered: asked((await gitTreeOf(root))!) };
  }

  it.runIf(native)('agrees over a clean checkout', async () => {
    const { oracle, answered } = await both(await repository());

    expect(answered).toEqual(oracle);
  });

  it.runIf(native)('agrees when the working tree has moved under it', async () => {
    const root = await repository();
    // Every overlay rule at once, because they are applied in one pass and a
    // rename is the one status line that can consume the next path.
    await write(root, 'src/Button.tsx', 'export function Button() { return <b /> }\n');
    await write(root, 'src/staged.ts', 'export const staged = 1\n');
    await git(root, ['add', 'src/staged.ts']);
    await write(root, 'src/staged.ts', 'export const staged = 2\n');
    await write(root, 'src/Clock.tsx', 'export const Clock = () => null\n');
    await unlink(join(root, 'docs/readme.md'));
    await git(root, ['mv', 'src/tokens.css', 'src/theme.css']);

    const { oracle, answered } = await both(root);

    expect(answered).toEqual(oracle);
  });

  it.runIf(native)('agrees on a tree whose only configuration is gone', async () => {
    const root = await repository();
    await unlink(join(root, 'tsconfig.json'));

    const { oracle, answered } = await both(root);

    expect(answered).toEqual(oracle);
  });

  it.runIf(native)('answers nothing outside a checkout, as the oracle does', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-native-'));
    made.push(root);
    await write(root, 'src/Button.tsx', 'export function Button() { return null }\n');

    expect(await gitTreeOf(root)).toBeUndefined();
    expect(await gitDigests(root)).toBeUndefined();
  });

  it('answers through the JavaScript tree when no scanner was built', async () => {
    // The binary is optional by construction: a checkout without a Rust
    // toolchain builds everything else and scans at the speed it always did.
    const root = await repository();
    const tree = treeOf((await gitDigests(root))!);

    expect(tree.size).toBe(11);
    expect(tree.named(['package.json'])).toEqual(['package.json', 'tsconfig.json']);
    // Code units, not code points. The last two are the pair that separates the
    // two orders: a surrogate pair leads with 0xD83D and sorts under U+FF5E,
    // while its UTF-8 bytes lead with 0xF0 and sort above U+FF5E's 0xEF.
    expect(tree.paths().filter((path) => /[^\p{ASCII}]/u.test(path))).toEqual([
      'src/caf\u00e9/\u00fcber.ts',
      'src/\u{1F600}.ts',
      'src/\uFF5E.ts',
    ]);
    expect(tree.get('src/Button.tsx')).toMatch(/^git:[0-9a-f]{40}$/u);
    expect(tree.directories().get('')).toBe(tree.directories().get(''));
  });
});

/** Run `git`, returning its output. Identity is passed in, never inherited. */
async function git(root: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run(
    'git',
    ['-c', 'user.email=test@example.test', '-c', 'user.name=Test', ...args],
    { cwd: root },
  );

  return stdout.trim();
}

async function write(root: string, file: string, contents: string): Promise<void> {
  const path = join(root, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
}
