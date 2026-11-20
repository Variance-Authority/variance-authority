import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { native } from './addon.js';
import { openImmutableLog } from './immutable-log.js';
import {
  publishedSources,
  readPublishedSources,
  sourcesWithin,
  updateSourceIndex,
  SourceIndexUnpublished,
} from './published.js';
import { scanRelations } from './test-support/scan.js';
import { sourceIndexPath } from './source-index.js';
import { SOURCE_INDEX_VERSION } from './source-index-format.js';

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

  it('hands back the parse and targets it holds for a file, and nothing for a file it does not hold', async () => {
    const at = index('indexed');
    await updateSourceIndex(root, { index: at });
    const read = await readPublishedSources(at);
    expect(read.indexed('app/lens.ts')).toMatchObject({ parsed: expect.anything(), targets: ['lib/unit.ts'] });
    expect(read.indexed('app/missing.ts')).toBeUndefined();
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

  it('says when it began reading, before its first step, whichever way it reads', async () => {
    const at = index('began');
    await updateSourceIndex(root, { index: at });
    for (const packs of [undefined, false]) {
      let first: number | undefined;
      const update = await updateSourceIndex(root, {
        index: at,
        ...(packs === undefined ? {} : { packs }),
        progress: () => {
          first ??= Date.now();
          return () => {};
        },
      });
      expect(Date.parse(update.readStartedAt)).toBeLessThanOrEqual(first!);
    }
  });

  it('says which step it is on, and when each one ends, while it updates', async () => {
    const at = index('progress');
    const told: string[] = [];
    const progress = (step: string): (() => void) => {
      told.push(`start ${step}`);
      return () => told.push(`end ${step}`);
    };
    const listed = realpathSync(root);

    await updateSourceIndex(root, { index: at, progress });
    // With no index to update, the whole checkout is read, and the last step says so.
    expect(told.slice(-2)).toEqual([
      `start reading every file of ${root}, because there is no index to update`,
      `end reading every file of ${root}, because there is no index to update`,
    ]);

    told.length = 0;
    await updateSourceIndex(root, { index: at, progress });
    // The git listing is its own step: on a large checkout it is most of the update.
    expect(told).toEqual([
      `start listing ${listed}`,
      `end listing ${listed}`,
      'start reading the files that changed since the last index',
      'end reading the files that changed since the last index',
    ]);
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

  it('keeps an index over the directories it is given, warm or cold', async () => {
    const at = index('dirs');
    const cold = await updateSourceIndex(root, { index: at, dirs: ['lib'] });
    expect(cold).toMatchObject({ was: 'missing', files: 2, reread: 2 });
    expect((await readPublishedSources(at)).records).toEqual(await scanRelations({ root, dirs: ['lib'] }));

    // A wider scope over the same index reads only what the narrower one had not.
    expect(await updateSourceIndex(root, { index: at, dirs: ['app'] })).toMatchObject({ files: 4, reread: 3 });
    expect((await readPublishedSources(at)).records).toEqual(await scanRelations({ root, dirs: ['app'] }));
  });

  it('keeps one index for a checkout, however the path to it is spelled', async () => {
    const link = join(cache, 'link');
    await symlink(root, link);

    expect(sourceIndexPath(link, cache)).toBe(sourceIndexPath(root, cache));
  });

  /** `run` under a cache of its own, with `names` cut as worktrees of the fixture at its commit. */
  async function worktrees(names: readonly string[], run: (paths: string[]) => Promise<void>): Promise<void> {
    const layers = await mkdtemp(join(tmpdir(), 'variance-published-layers-'));
    const paths = names.map((name) => join(layers, name));
    const cacheHome = process.env['VARIANCE_AUTHORITY_CACHE'];
    process.env['VARIANCE_AUTHORITY_CACHE'] = join(layers, 'cache');
    try {
      for (const path of paths) git('worktree', 'add', '--quiet', '--detach', path);
      await run(paths);
    } finally {
      if (cacheHome === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
      else process.env['VARIANCE_AUTHORITY_CACHE'] = cacheHome;
      for (const path of paths) git('worktree', 'remove', '--force', path);
      await rm(layers, { recursive: true, force: true });
    }
  }

  it("starts a worktree's index from its primary checkout's, reading only the files that differ", async () => {
    await worktrees(['same', 'edited', 'damaged'], async ([same, edited, damaged]) => {
      const primary = await updateSourceIndex(root);
      const published = await openImmutableLog(primary.path);

      const first = await updateSourceIndex(same!);
      expect(first).toMatchObject({ was: 'missing', from: primary.path, files: 5, reread: 0, parsed: 0 });
      expect(first.path).not.toBe(primary.path);
      // Nothing differs, so no record is encoded: the primary's segments are its own,
      // under one that holds only its configuration.
      expect((await openImmutableLog(first.path)).digests.slice(0, published.digests.length)).toEqual(published.digests);
      expect((await readPublishedSources(first.path)).records).toEqual(await scanRelations({ root: same!, dirs: ['.'] }));

      // An edit made there first costs what an update for that edit costs: the file that moved.
      await writeFile(join(edited!, 'lib/alone.ts'), 'export const alone = 3;\n');
      const moved = await updateSourceIndex(edited!);
      expect(moved).toMatchObject({ was: 'missing', files: 5, reread: 1, parsed: 1 });
      expect((await readPublishedSources(moved.path)).records).toEqual(await scanRelations({ root: edited!, dirs: ['.'] }));
      expect((await openImmutableLog(primary.path)).digests).toEqual(published.digests);

      // One it cannot stand on starts there too, rather than from every file.
      await mkdir(dirname(sourceIndexPath(damaged!)), { recursive: true });
      await writeFile(sourceIndexPath(damaged!), 'not an index');
      expect(await updateSourceIndex(damaged!)).toMatchObject({ was: 'damaged', from: primary.path, files: 5, reread: 0, parsed: 0 });
    });
  });

  it("starts a checkout's index from any other checkout of the repository that holds one", async () => {
    await worktrees(['first', 'second'], async ([first, second]) => {
      // No checkout holds an index yet, so the first reads every file.
      expect(await updateSourceIndex(first!)).toMatchObject({ was: 'missing', files: 5, reread: 5 });
      expect(await updateSourceIndex(second!)).toMatchObject({ was: 'missing', files: 5, reread: 0, parsed: 0 });
      const primary = await updateSourceIndex(root);
      expect(primary).toMatchObject({ was: 'missing', files: 5, reread: 0, parsed: 0 });
      expect((await readPublishedSources(primary.path)).records).toEqual(await scanRelations({ root, dirs: ['.'] }));
    });
  });

  it('publishes a file it could not read as unknown, rather than leaving it out', async () => {
    const bundled = await mkdtemp(join(tmpdir(), 'variance-published-unknown-'));
    try {
      await writeFile(join(bundled, 'index.js'), "import './bundle.js';\n");
      await writeFile(join(bundled, 'bundle.js'), `export const bytes = '${'x'.repeat(1024 * 1024)}';\n`);
      execFileSync('git', ['init', '--quiet'], { cwd: bundled });
      execFileSync('git', ['add', '.'], { cwd: bundled });
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'bundle'], {
        cwd: bundled,
      });
      const at = index('unknown');

      expect(await updateSourceIndex(bundled, { index: at })).toMatchObject({ files: 2, reread: 2 });
      const { records } = await readPublishedSources(at);
      expect(records).toEqual(await scanRelations({ root: bundled, dirs: ['.'] }));
      expect(records.find((record) => record.file === 'bundle.js')?.unknown).toMatch(/over the \d+ this scan opens/);
    } finally {
      await rm(bundled, { recursive: true, force: true });
    }
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

  it('says it repaired an index whose manifest does not read, and builds it again', async () => {
    const at = index('unreadable-manifest');
    await updateSourceIndex(root, { index: at });
    const manifest = await readFile(at);
    await writeFile(at, manifest.subarray(0, manifest.length - 1));

    const repaired = await updateSourceIndex(root, { index: at });
    expect(repaired.was).toBe('damaged');
    expect((await readPublishedSources(at)).state).toBe('published');
  });

  it('reads an index an earlier release wrote as one file, and updates it without calling it damaged', async () => {
    const current = index('legacy-source');
    await updateSourceIndex(root, { index: current });
    const [base] = (await openImmutableLog(current)).segments;
    const at = index('legacy');
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, base!);
    expect((await readPublishedSources(at)).state).toBe('published');
    const updated = await updateSourceIndex(root, { index: at });
    expect(updated.was).toBe('published');
    expect((await readPublishedSources(at)).state).toBe('published');
  });

  it('tells an index written in another format version from a damaged one, rebuilds it on a workstation, and refuses it in CI', async () => {
    // The chain an earlier release published: the same segments under a format
    // version this reader does not read, every digest of them whole.
    const current = index('current');
    await updateSourceIndex(root, { index: current });
    // 0.14.0 wrote 15, a number as wide as this reader's, so the header keeps its length.
    const written = `"version":${SOURCE_INDEX_VERSION},`;
    const older = (await openImmutableLog(current)).segments.map((segment) => {
      const header = segment.indexOf(written);
      expect(header).toBeGreaterThan(0);
      expect(header).toBeLessThan(4 + segment.readUInt32LE(0));
      return Buffer.concat([
        segment.subarray(0, header),
        Buffer.from('"version":15,'),
        segment.subarray(header + written.length),
      ]);
    });
    const at = index('older');
    expect(native()!.appendSourceIndex(at, [], false, older)).toBeNull();
    expect((await readPublishedSources(at)).state).toBe('other-version');

    const said: string[] = [];
    const options = { step: 'variance index', announce: (line: string) => said.push(line), index: at };
    const refused = publishedSources(root, { ...options, ci: true });
    await expect(refused).rejects.toBeInstanceOf(SourceIndexUnpublished);
    await expect(refused).rejects.toThrow(
      `the source index at ${at} was written in format version 15, and this release reads version ${SOURCE_INDEX_VERSION}. ` +
      'In CI the index is a step of the pipeline: run `variance index` with this release before this command.',
    );

    const read = await publishedSources(root, { ...options, ci: false });
    expect(said).toEqual([
      `the source index at ${at} was written in format version 15, and this release reads version ${SOURCE_INDEX_VERSION}; ` +
      'rebuilding it from the checkout, which is what `variance index` does.',
    ]);
    expect(read.state).toBe('published');
    expect(read.records).toEqual(await scanRelations({ root, dirs: ['.'] }));
  });
});
