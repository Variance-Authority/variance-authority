import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { native } from './addon.js';
import { digestString } from './digest.js';
import { keyFor, parseWay } from './files.js';
import { updateNatively } from './native-update.js';
import { readSourceIndex } from './test-support/source-index-file.js';

const entry = 'pub fn entry() {}\n';
const unused = 'pub struct Unused;\n';
const unusedKey = keyFor(digestString(unused), parseWay('unused.rs'));

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sense-rust-retention-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/lib.rs'), entry);
  await writeFile(join(root, 'unused.rs'), unused);
  return root;
}

it.each([false, true])('offers unused Rust preparation parses to the shared store without graph records or index parses (Git: %s)', async (git) => {
  const root = await fixture();
  try {
    if (git) {
      const command = (...args: string[]): void => { execFileSync('git', args, { cwd: root }); };
      command('init', '--quiet');
      command('add', '.');
      command('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');
    }
    const key = git ? keyFor(native()!.gitTree(root)!.digest('unused.rs')!, parseWay('unused.rs')) : unusedKey;
    const index = join(root, '.cache', 'index.bin');
    const store = join(root, '.cache', 'parses.bin');
    expect(await updateNatively(root, index, undefined, ['src'], [store]))
      .toMatchObject({ files: 1, parsed: 2 });
    const stored = await readSourceIndex(index);
    expect([...stored.records.keys()]).toEqual(['src/lib.rs']);
    expect(stored.parses.has(key)).toBe(false);
    expect((await readSourceIndex(store)).parses.has(key)).toBe(true);
    await writeFile(join(root, 'src/lib.rs'), 'pub fn changed() {}\n');
    expect(await updateNatively(root, index, undefined, ['src'], [store]))
      .toMatchObject({ files: 1, parsed: 1 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
