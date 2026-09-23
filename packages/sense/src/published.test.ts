import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openImmutableLog } from './immutable-log.js';
import {
  publishedSources,
  readPublishedSources,
  sourcesWithin,
  updateSourceIndex,
  SourceIndexUnpublished,
} from './published.js';
import { scanRelations } from './scan.js';
import { sourceIndexPath } from './source-index.js';

/**
 * One step publishes the index; a reader reads it and scans nothing.
 *
 * The fixture is a committed Git checkout, because reuse is keyed by the digests
 * Git holds: without them every update reads every file again and the layer
 * claim below would be vacuous.
 */

describe('the published source index', () => {
  let root: string;
  let cache: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-published-'));
    cache = await mkdtemp(join(tmpdir(), 'variance-published-index-'));
    await write('package.json', '{ "name": "fixture" }');
    await write('app/index.ts', "import { lens } from './lens.js';\nexport const app = lens;\n");
    await write('app/lens.ts', "import { unit } from '../lib/unit.js';\nexport const lens = unit;\n");
    await write('lib/unit.ts', 'export const unit = 1;\n');
    await write('lib/alone.ts', 'export const alone = 2;\n');
    await write('app/lens.test.ts', "import { vi } from 'vitest';\nimport { lens } from './lens.js';\nvi.mock('./lens.js');\nvoid lens;\n");
    git('init', '--quiet');
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(cache, { recursive: true, force: true });
  });

  async function write(file: string, text: string): Promise<void> {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }

  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: root });
  }

  function index(name: string): string {
    return join(cache, name, 'source-index.bin');
  }

  it('publishes what a scan of the whole checkout finds, and a reader reads it back', async () => {
    const at = index('whole');
    const update = await updateSourceIndex(root, { index: at });
    expect(update).toMatchObject({ path: at, was: 'missing', files: 5, reread: 5 });

    const read = await readPublishedSources(at);
    expect(read.state).toBe('published');
    expect(read.generation.length).toBeGreaterThan(0);
    expect(read.records).toEqual(await scanRelations({ root, dirs: ['.'] }));
  });

  it('absorbs an edit as a layer, reading only the file that moved', async () => {
    const at = index('layered');
    await updateSourceIndex(root, { index: at });
    const before = await openImmutableLog(at);

    const unchanged = await updateSourceIndex(root, { index: at });
    expect(unchanged).toMatchObject({ was: 'published', files: 5, reread: 0 });

    await write('lib/alone.ts', "import { unit } from './unit.js';\nexport const alone = unit;\n");
    try {
      const edited = await updateSourceIndex(root, { index: at });
      expect(edited).toMatchObject({ was: 'published', files: 5, reread: 1 });
      const after = await openImmutableLog(at);
      expect(after.digests.slice(0, before.digests.length)).toEqual(before.digests);
      expect((await readPublishedSources(at)).records)
        .toEqual(await scanRelations({ root, dirs: ['.'] }));
    } finally {
      git('checkout', '--', 'lib/alone.ts');
    }
  });

  it('answers a narrower scope with the records a scan of that scope would read', async () => {
    const at = index('within');
    await updateSourceIndex(root, { index: at });
    const { records } = await readPublishedSources(at);

    expect(sourcesWithin(records, root, ['app'])).toEqual(await scanRelations({ root, dirs: ['app'] }));
    expect(sourcesWithin(records, root, ['lib'])).toEqual(await scanRelations({ root, dirs: ['lib'] }));
    expect(sourcesWithin(records, root, ['lib'], ['app/index.ts']).map((record) => record.file))
      .toEqual(['app/index.ts', 'app/lens.ts', 'lib/alone.ts', 'lib/unit.ts']);
  });

  it('keeps one index for a checkout, however the path to it is spelled', async () => {
    const link = join(cache, 'link');
    await symlink(root, link);

    expect(sourceIndexPath(link, cache)).toBe(sourceIndexPath(root, cache));
  });

  it('refuses in CI when nothing is published, and names the step the pipeline lacks', async () => {
    const at = index('refused');
    const said: string[] = [];
    const reading = publishedSources(root, {
      ci: true,
      step: 'variance index',
      announce: (line) => said.push(line),
      index: at,
    });

    await expect(reading).rejects.toBeInstanceOf(SourceIndexUnpublished);
    await expect(reading).rejects.toThrow(/run `variance index` before this command/);
    expect(said).toEqual([]);
    expect((await readPublishedSources(at)).state).toBe('missing');
  });

  it('builds on a workstation when nothing is published, and says so in one line', async () => {
    const at = index('local');
    const said: string[] = [];
    const read = await publishedSources(root, {
      ci: false,
      step: 'variance index',
      announce: (line) => said.push(line),
      index: at,
    });

    expect(read.state).toBe('published');
    expect(read.records.map((record) => record.file)).toHaveLength(5);
    expect(said).toEqual([
      `no source index is published at ${at}; updating it from the checkout, which is what \`variance index\` does.`,
    ]);
  });

  it('repairs a damaged index from its valid prefix on a workstation, and refuses it in CI', async () => {
    const at = index('damaged');
    await updateSourceIndex(root, { index: at });
    await write('lib/unit.ts', 'export const unit = 3;\n');
    try {
      await updateSourceIndex(root, { index: at });
    } finally {
      git('checkout', '--', 'lib/unit.ts');
    }
    const [, later] = (await openImmutableLog(at)).digests;
    await writeFile(join(`${at}.segments`, `${later!.replace(':', '-')}.bin`), 'corrupt');
    expect((await readPublishedSources(at)).state).toBe('damaged');

    const options = { step: 'variance index', announce: () => {}, index: at };
    await expect(publishedSources(root, { ...options, ci: true }))
      .rejects.toThrow(/is damaged, and reads only up to its first bad segment/);

    const read = await publishedSources(root, { ...options, ci: false });
    expect(read.state).toBe('published');
    expect(read.records).toEqual(await scanRelations({ root, dirs: ['.'] }));
  });
});
