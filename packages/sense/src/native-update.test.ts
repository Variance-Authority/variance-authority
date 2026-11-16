import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openImmutableLog } from './immutable-log.js';
import { decodeSourceIndex } from './source-index-format.js';
import { openSourceIndexFile } from './source-index-file.js';
import { updateNatively } from './native-update.js';
import { readySourceIndex } from './ready-index.js';
import { updateSourceIndex } from './published.js';
import { realPath } from './resolve.js';

/**
 * The addon's warm update and a fresh native index are asked the same thing from
 * the same chain, and what they publish is compared record for record, each
 * parse with the declarations it harvested: `symbol` and `uses` read those
 * for a changed file off the working layer.
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
    // Declarations included: `ask symbol` reads them from whichever update wrote the parse.
    return { records: sorted(file.stored.records), parses: sorted(file.stored.parses), directories: sorted(file.stored.directories) };
  }

  async function agree(change: () => Promise<void>): Promise<void> {
    const start = await both();
    const twin = join(work, `twin-${step}`, 'index.bin');
    await mkdir(dirname(twin), { recursive: true });
    await change();
    const native = await updateNatively(root, start);
    expect(native).toBeDefined();
    await updateSourceIndex(root, { index: twin });
    expect(await held(start)).toEqual(await held(twin));
  }

  it('matches a fresh native index after an edit', async () => {
    await agree(async () => {
      await write('lib/unit.ts', 'export const unit = 3;\nexport const more = 4;\n');
    });
    git('checkout', '--', 'lib/unit.ts');
  });

  it('matches a fresh native index after a file is added and imported', async () => {
    await agree(async () => {
      await write('lib/added.ts', 'export const added = 5;\n');
      await write('lib/alone.ts', "import { added } from './added.js';\nexport const alone = added;\n");
      git('add', 'lib/added.ts');
    });
    git('checkout', '-f', 'HEAD', '--', 'lib/alone.ts');
    git('rm', '-q', '--cached', 'lib/added.ts');
    await rm(join(root, 'lib/added.ts'));
  });

  it('matches a fresh native index after a file is deleted', async () => {
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

  it('leaves a file put back as the base holds it out of the working layer', async () => {
    const start = await both();
    const base = (await chain(start)).segments;
    await write('lib/unit.ts', 'export const unit = 6;\n');
    await updateNatively(root, start);
    git('checkout', '--', 'lib/unit.ts');
    await updateNatively(root, start);
    expect(await chain(start)).toEqual({ segments: base + 1, working: 1 });
    const working = decodeSourceIndex((await openImmutableLog(start)).segments.at(-1)!);
    expect([...working.records.keys()]).toEqual([]);
    // Its parse too: the base already holds the same harvested parse under that key.
    expect([...working.parses.keys()]).toEqual([]);
  });

  it('writes nothing when nothing changed', async () => {
    const start = await both();
    const before = await held(start);
    const native = await updateNatively(root, start);
    expect(native?.reread).toBe(0);
    expect(await held(start)).toEqual(before);
  });

  it('rebuilds an index whose segment of the published length names the wrong bytes', async () => {
    const start = await both();
    const before = await held(start);
    const [digest] = (await openImmutableLog(start)).digests;
    const segment = join(`${start}.segments`, `${digest!.replace(':', '-')}.bin`);
    const bytes = await readFile(segment);
    const length = bytes.readUInt32LE(0);
    const header = JSON.parse(bytes.subarray(4, 4 + length).toString().replace(/\0+$/, '')) as { sections: { name: string; offset: number }[] };
    header.sections.find((section) => section.name === 'index.config')!.offset = 0;
    Buffer.from(JSON.stringify(header).padEnd(length, '\0')).copy(bytes, 4);
    await writeFile(segment, bytes);

    expect(await updateSourceIndex(root, { index: start })).toMatchObject({ was: 'damaged' });
    expect(await held(start)).toEqual(before);
  });

  it('rebuilds an index whose segment of the published length holds a flag that is neither 0 nor 1', async () => {
    const start = await both();
    const before = await held(start);
    const digest = (await openImmutableLog(start)).digests.at(-1);
    const segment = join(`${start}.segments`, `${digest!.replace(':', '-')}.bin`);
    const bytes = await readFile(segment);
    const length = bytes.readUInt32LE(0);
    const header = JSON.parse(bytes.subarray(4, 4 + length).toString().replace(/\0+$/, '')) as { sections: { name: string; offset: number }[] };
    const present = 4 + length + header.sections.find((section) => section.name === 'records.edges-present')!.offset;
    expect(bytes[present]).toBe(1);
    bytes[present] = 3;
    await writeFile(segment, bytes);

    expect(await updateSourceIndex(root, { index: start })).toMatchObject({ was: 'damaged' });
    expect(await held(start)).toEqual(before);
  });

  it('starts a cold index without a parse store and updates it natively', async () => {
    const index = join(work, 'never', 'index.bin');
    expect(await updateNatively(root, index)).toMatchObject({ was: 'missing', files: 4, reread: 4 });
    expect(await updateNatively(root, index)).toMatchObject({ was: 'published', files: 4, reread: 0 });
  });
});
