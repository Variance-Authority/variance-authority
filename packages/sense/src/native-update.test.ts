import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openSourceIndexFile } from './source-index-file.js';
import { updateNatively } from './native-update.js';
import { readySourceIndex } from './ready-index.js';
import { updateSourceIndex } from './published.js';
import { realPath } from './resolve.js';
import { gitTreeOf } from './tree.js';

/**
 * The addon's warm update and the JavaScript one are asked the same thing from
 * the same chain, and what they publish is compared record for record.
 */
describe('the native warm update', () => {
  let root: string;
  let work: string;
  let step = 0;

  beforeAll(async () => {
    root = realPath(await mkdtemp(join(tmpdir(), 'variance-native-update-')));
    work = realPath(await mkdtemp(join(tmpdir(), 'variance-native-update-index-')));
    await write('package.json', '{ "name": "fixture" }');
    await write('app/index.ts', "import { lens } from './lens.js';\nexport const app = lens;\n");
    await write('app/lens.ts', "import { unit } from '../lib/unit.js';\nexport const lens = unit;\n");
    await write('lib/unit.ts', 'export const unit = 1;\n');
    await write('lib/alone.ts', 'export const alone = 2;\n');
    git('init', '--quiet');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  });

  async function write(file: string, text: string): Promise<void> {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }

  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  }

  /** Both updates from one published chain, and what each one left. */
  async function both() {
    const index = join(work, `base-${step++}`, 'index.bin');
    await mkdir(dirname(index), { recursive: true });
    await updateSourceIndex(root, { index });
    return index;
  }

  async function held(index: string) {
    const file = await openSourceIndexFile(index);
    const sorted = (map: ReadonlyMap<string, unknown>) => JSON.stringify([...map].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    // A parse the addon read carries no harvest yet, as a cold build's does; JavaScript adds it when something asks.
    const unharvested = new Map([...file.stored.parses].map(([key, { symbols: _symbols, harvested: _harvested, ...rest }]) => [key, rest]));
    return { records: sorted(file.stored.records), parses: sorted(unharvested), directories: sorted(file.stored.directories) };
  }

  async function agree(change: () => Promise<void>): Promise<void> {
    const start = await both();
    const twin = join(work, `twin-${step}`, 'index.bin');
    await mkdir(dirname(twin), { recursive: true });
    await cp(start, twin);
    await cp(`${start}.segments`, `${twin}.segments`, { recursive: true });
    await change();
    const native = await updateNatively(root, start);
    expect(native).toBeDefined();
    // The addon is refused for the twin by holding the same tree without the entry.
    const tree = (await gitTreeOf(root, ['.']))!.native!;
    const proto = Object.getPrototypeOf(tree) as { updateIndex?: unknown };
    const entry = proto.updateIndex;
    proto.updateIndex = undefined;
    try {
      await updateSourceIndex(root, { index: twin });
    } finally {
      proto.updateIndex = entry;
    }
    expect(await held(start)).toEqual(await held(twin));
  }

  it('publishes what the JavaScript update publishes after an edit', async () => {
    await agree(async () => {
      await write('lib/unit.ts', 'export const unit = 3;\nexport const more = 4;\n');
    });
    git('checkout', '--', 'lib/unit.ts');
  });

  it('publishes what the JavaScript update publishes after a file is added and imported', async () => {
    await agree(async () => {
      await write('lib/added.ts', 'export const added = 5;\n');
      await write('lib/alone.ts', "import { added } from './added.js';\nexport const alone = added;\n");
      git('add', 'lib/added.ts');
    });
    git('checkout', '-f', 'HEAD', '--', 'lib/alone.ts');
    git('rm', '-q', '--cached', 'lib/added.ts');
    await rm(join(root, 'lib/added.ts'));
  });

  it('publishes what the JavaScript update publishes after a file is deleted', async () => {
    await agree(async () => {
      await rm(join(root, 'lib/alone.ts'));
    });
    git('checkout', '--', 'lib/alone.ts');
  });

  /** The segments the manifest at `index` names, and how many of the last are the working layer. */
  async function chain(index: string): Promise<{ segments: number; working: number }> {
    const manifest = JSON.parse((await readFile(index)).subarray(12).toString('utf8')) as { segments: unknown[]; working?: number };
    return { segments: manifest.segments.length, working: manifest.working ?? 0 };
  }

  it('rewrites one working layer over the base, keeping what an earlier update deleted, and readying folds it in', async () => {
    const start = await both();
    const base = (await chain(start)).segments;
    await rm(join(root, 'lib/alone.ts'));
    await updateNatively(root, start);
    await write('lib/unit.ts', 'export const unit = 5;\n');
    await updateNatively(root, start);
    expect(await chain(start)).toEqual({ segments: base + 1, working: 1 });
    const twin = join(work, `twin-${step}`, 'index.bin');
    await mkdir(dirname(twin), { recursive: true });
    await updateSourceIndex(root, { index: twin });
    expect(await held(start)).toEqual(await held(twin));

    expect(await readySourceIndex(start)).toBe(true);
    expect(await chain(start)).toEqual({ segments: 1, working: 0 });
    expect(await held(start)).toEqual(await held(twin));
    expect(await readySourceIndex(start)).toBe(false);
    git('checkout', '--', 'lib/alone.ts', 'lib/unit.ts');
  });

  it('writes nothing when nothing changed', async () => {
    const start = await both();
    const before = await held(start);
    const native = await updateNatively(root, start);
    expect(native?.reread).toBe(0);
    expect(await held(start)).toEqual(before);
  });

  it('declines an index nobody published, leaving it to the JavaScript update', async () => {
    expect(await updateNatively(root, join(work, 'never', 'index.bin'))).toBeUndefined();
  });
});
