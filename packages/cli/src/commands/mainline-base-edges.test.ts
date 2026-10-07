import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishLine } from '@variance-authority/core/share';
import {
  cacheRootFor,
  commitRunsFile,
  declaredSuites,
  mainlineReadRoot,
  testCoverageFile,
  withCaseSections,
} from '@variance-authority/sense/test-selection';
import type { Config } from '../config.js';
import { EXIT_CLEAN } from '../exit.js';
import { frame, suiteEntry } from '../share-entries.js';
import { lineCellOf, type Env } from '../share-lines.js';
import { MISS_STANDS_MS, mainlineBase, mainlineMissed } from './mainline-base.js';
import { DISCOUNTS, GIT_SHARE, PUSH, collectedBoth, git, gitPublished, ranWhole, recordIn } from './mainline-fixture.js';
import { suiteBase } from './suite-base.js';
import { publishSuite, suiteShare } from './suite-share.js';

/**
 * The edges of reading the mainline's record that the readers' own tests do
 * not reach: a line that did not answer, or answered with no record, a moment
 * ago, a note of that which does not hold, a cache that cannot keep the note,
 * an entry whose record keeps no cases and that carries no runs, a record path
 * that cannot be asked, and a suite not given to the share at all.
 */

const LOCAL: Env = {};
const NOW = Date.parse('2026-09-30T12:00:00.000Z');
const DAY = 24 * 60 * 60_000;
const at = (time: number) => new Date(time).toISOString();
let home: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'variance-mainline-edges-')));
});

afterEach(async () => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

/** A clone of `origin` with a cache of its own, and what `mainlineBase` asks of it. */
async function laptop(origin: string) {
  const dir = join(home, 'clone');
  await git(home, 'clone', '--quiet', origin, dir);
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'laptop-cache');
  const declared = declaredSuites(dir)?.find((one) => one.name === 'unit');
  const readRoot = mainlineReadRoot(cacheRootFor(dir), 'unit');
  const base = (now: number) => mainlineBase(dir, declared, { env: LOCAL, now });
  const reach = (url: string) => git(dir, 'remote', 'set-url', 'origin', url);
  return { dir, readRoot, base, reach, nowhere: join(home, 'nowhere.git') };
}

/** A commit pushed to `ci`'s `main`, and none of its records published. */
async function pushed(ci: string): Promise<string> {
  await git(ci, 'commit', '--quiet', '--allow-empty', '-m', 'next');
  await git(ci, 'push', '--quiet', 'origin', 'main');
  return git(ci, 'rev-parse', 'HEAD');
}

/** A commit pushed to `ci`'s `main`, and the record CI made there published to the mainline. */
async function publishedNext(ci: string): Promise<string> {
  const commit = await pushed(ci);
  const reader = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'ci-cache');
  await recordIn(ci, commit, ['test/total.test.ts'], [DISCOUNTS]);
  await ranWhole(testCoverageFile(ci, { suite: 'unit' }), commit);
  const done = await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) });
  if (reader === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = reader;
  expect(done).toMatchObject({ published: { written: [suiteEntry('unit')] } });
  return commit;
}

/** Take back the git cell's held answers under `cache`, as a minute passing would. */
async function forgetLineAnswers(cache: string): Promise<void> {
  const held = (await readdir(cache, { recursive: true })).filter((path) => basename(path) === 'variance-fetched');
  for (const dir of held) await rm(join(cache, dir), { recursive: true, force: true });
  expect(held).not.toEqual([]);
}

describe('a line that gave no record a moment ago', () => {
  it('is not asked again for ten minutes when nothing was fetched earlier, and the miss says when the line answered', async () => {
    const { origin, first } = await gitPublished(home);
    const { readRoot, base, reach, nowhere } = await laptop(origin);
    await reach(nowhere);

    const missed = await base(NOW);
    if (missed === undefined || !('miss' in missed)) throw new Error(`expected a miss, read ${JSON.stringify(missed)}`);
    expect(missed).toMatchObject({ suite: 'unit', mainline: 'main', miss: { kind: 'unreachable' } });
    expect(existsSync(join(readRoot, 'missed.json'))).toBe(true);
    // Reachable again, and not asked: the note answers until the window closes.
    await reach(origin);

    expect(await base(NOW + MISS_STANDS_MS - 1)).toEqual({ suite: 'unit', mainline: 'main', miss: missed.miss, asked: at(NOW) });
    expect(await base(NOW + MISS_STANDS_MS)).toMatchObject({ commit: first, fetched: at(NOW + MISS_STANDS_MS) });
    expect(existsSync(join(readRoot, 'missed.json'))).toBe(false);
  });

  it('is not asked again for ten minutes when it answered that it holds none, so a record published since waits for the window', async () => {
    // Every job of one CI run reads the same answer: the one `base` read, held
    // or not, never a record the line came to hold while the run was starting.
    const { ci, origin, first } = await gitPublished(home, { publish: false });
    const { readRoot, base } = await laptop(origin);

    const missed = await base(NOW);
    if (missed === undefined || !('miss' in missed)) throw new Error(`expected a miss, read ${JSON.stringify(missed)}`);
    expect(missed.miss.kind).toBe('absent');
    const laptopCache = process.env['VARIANCE_AUTHORITY_CACHE'];
    process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'ci-cache');
    const done = await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) });
    process.env['VARIANCE_AUTHORITY_CACHE'] = laptopCache;
    expect(done).toMatchObject({ published: { written: [suiteEntry('unit')] } });
    // The git cell holds its own answer for a minute of the wall clock; this
    // read is minutes later on the reader's clock, so that one is gone.
    await forgetLineAnswers(join(home, 'laptop-cache'));

    const again = await base(NOW + MISS_STANDS_MS - 1);

    expect(again).toEqual({ ...missed, asked: at(NOW) });
    expect(mainlineMissed(again as typeof missed)).toBe(
      `${mainlineMissed(missed)}; that was the line's answer at ${at(NOW)}, which stands for 10 minutes`,
    );
    expect(existsSync(join(readRoot, 'missed.json'))).toBe(true);
    expect(await base(NOW + MISS_STANDS_MS)).toMatchObject({ commit: first, fetched: at(NOW + MISS_STANDS_MS) });
  });

  it('is not asked again when a record was fetched earlier, and that record stands with the note\'s miss', async () => {
    const { ci, origin, first } = await gitPublished(home);
    const { dir, base, reach, nowhere } = await laptop(origin);
    expect(await base(NOW)).toMatchObject({ commit: first, fetched: at(NOW) });
    // The merge base moves past the record, so the line is asked again.
    await pushed(ci);
    await git(dir, 'pull', '--quiet', '--ff-only');
    await reach(nowhere);
    const later = NOW + DAY;
    expect(await base(later)).toMatchObject({ commit: first, earlier: { unanswered: { kind: 'unreachable' } } });
    await reach(origin);

    const kept = await base(later + 1);

    expect(kept).toMatchObject({ commit: first, fetched: at(NOW), earlier: { unanswered: { kind: 'unreachable' }, asked: at(later) } });
  });

  it('is asked when the note does not read, has the wrong shape, or is another mainline\'s', async () => {
    const { origin, first } = await gitPublished(home);
    const { readRoot, base } = await laptop(origin);
    await mkdir(readRoot, { recursive: true });
    const notes = [
      '{',
      JSON.stringify({ mainline: 'main', at: at(NOW) }),
      JSON.stringify({ mainline: 'release', at: at(NOW), miss: { kind: 'unreachable', detail: 'gone' } }),
    ];

    for (const [step, note] of notes.entries()) {
      // No record fetched before it, so only the note could stop the ask.
      const now = NOW + step;
      await rm(join(readRoot, 'fetched.json'), { force: true });
      await writeFile(join(readRoot, 'missed.json'), note.replace(at(NOW), at(now)));

      const read = await base(now);

      expect(read, note).toMatchObject({ commit: first, fetched: at(now) });
      expect(read, note).not.toHaveProperty('earlier');
    }
  });

  it('is still named as the miss when the cache cannot keep the note, and is asked again next time', async () => {
    const { origin } = await gitPublished(home);
    const { readRoot, base, reach, nowhere } = await laptop(origin);
    await reach(nowhere);
    await mkdir(dirname(dirname(readRoot)), { recursive: true });
    await writeFile(dirname(readRoot), '');

    expect(await base(NOW)).toMatchObject({ suite: 'unit', mainline: 'main', miss: { kind: 'unreachable' } });
    const again = await base(NOW + 1);

    expect(again).toMatchObject({ miss: { kind: 'unreachable' } });
    expect(again).not.toHaveProperty('asked');
  });
});

describe('a record fetched earlier, against this checkout\'s merge base with the mainline', () => {
  it('stands at the merge base a day later, with the line not asked', async () => {
    const { origin, first } = await gitPublished(home);
    const { base, reach, nowhere } = await laptop(origin);
    expect(await base(NOW)).toMatchObject({ commit: first, distance: 0, fetched: at(NOW) });
    await reach(nowhere);

    const kept = await base(NOW + DAY);

    expect(kept).toMatchObject({ commit: first, distance: 0, fetched: at(NOW), earlier: { reused: 'nearest' } });
  });

  it('stands past the merge base, because the line holds nothing nearer it', async () => {
    const { ci, origin } = await gitPublished(home);
    const next = await publishedNext(ci);
    const { dir, base, reach, nowhere } = await laptop(origin);
    expect(await base(NOW)).toMatchObject({ commit: next, distance: 0, fetched: at(NOW) });
    // A branch cut before the record: its merge base is one commit behind it.
    await git(dir, 'checkout', '--quiet', '-b', 'older', 'HEAD~1');
    await reach(nowhere);

    const kept = await base(NOW + DAY);

    expect(kept).toMatchObject({ commit: next, distance: -1, fetched: at(NOW), earlier: { reused: 'nearest' } });
  });

  it('is asked again once the merge base moves past it, and stands once asked there', async () => {
    const { ci, origin, first } = await gitPublished(home);
    const { dir, base, reach, nowhere } = await laptop(origin);
    expect(await base(NOW)).toMatchObject({ commit: first, fetched: at(NOW) });
    await pushed(ci);
    await git(dir, 'pull', '--quiet', '--ff-only');

    // A minute later: the line holds nothing newer, and is asked for it all the same.
    const asked = await base(NOW + 60_000);
    expect(asked).toMatchObject({ commit: first, distance: 1, fetched: at(NOW + 60_000) });
    expect(asked).not.toHaveProperty('earlier');
    await reach(nowhere);

    const kept = await base(NOW + DAY);

    expect(kept).toMatchObject({ commit: first, distance: 1, fetched: at(NOW + 60_000), earlier: { reused: 'asked' } });
  });
});

describe('an entry whose record keeps no cases and that carries no runs', () => {
  it('names no cases, leaves no runs beside the record, and takes back the runs an earlier fetch of the same commit left there', async () => {
    const { ci, origin, first, record: cased } = await gitPublished(home, { publish: false });
    const record = withCaseSections(cased, {});
    const cell = await lineCellOf({ share: GIT_SHARE, cacheRoot: join(home, 'ci-cache') } as unknown as Config, { cwd: ci });
    if (cell === undefined || !('load' in cell)) throw new Error(`no line cell: ${JSON.stringify(cell)}`);
    await publishLine(cell, { kind: 'mainline', name: 'main' }, [{ name: suiteEntry('unit'), commit: first, bytes: frame([['coverage.bin', record]]) }], {
      descends: async () => undefined,
      image: async (digest) => { throw new Error(`no image ${digest}`); },
    });
    const { readRoot, base } = await laptop(origin);
    const coverage = join(readRoot, first, 'coverage.bin');
    await mkdir(dirname(coverage), { recursive: true });
    await writeFile(commitRunsFile(coverage), 'stale runs');

    const read = await base(NOW);

    expect(read).toMatchObject({ commit: first, coverage });
    expect(read).not.toHaveProperty('cases');
    expect(read).not.toHaveProperty('runs');
    expect(await readFile(coverage)).toEqual(record);
    expect(existsSync(commitRunsFile(coverage))).toBe(false);
  });
});

describe('a fetch when the daily prune of the cache is due', () => {
  it('names what the prune took in the CLI cache\'s own words', async () => {
    const { origin, first } = await gitPublished(home);
    const { dir, base } = await laptop(origin);
    // `scans/` has no writer, so a due prune removes it whatever git answers.
    const scans = join(cacheRootFor(dir), 'scans');
    await mkdir(scans, { recursive: true });
    await writeFile(join(scans, 'left.bin'), 'left by an old version');

    const read = await base(NOW);

    expect(read).toMatchObject({ commit: first, fetched: at(NOW) });
    expect(read).toHaveProperty('pruned', expect.stringMatching(/^cache: freed \d+\.\d MiB in .+: 1 directory nothing writes any more$/u));
    expect(existsSync(scans)).toBe(false);
  });
});

describe('a record path the checkout cannot ask about', () => {
  it('is refused with the file system\'s answer, never read as a checkout that has recorded nothing', async () => {
    const { origin } = await gitPublished(home);
    const { dir } = await laptop(origin);
    const own = testCoverageFile(dir, { suite: 'unit' });
    await mkdir(dirname(dirname(own)), { recursive: true });
    await writeFile(dirname(own), '');

    await expect(suiteBase(dir, { env: LOCAL })).rejects.toMatchObject({ code: 'ENOTDIR' });
  });
});

describe('`variance share --suite` for a suite not given to the share', () => {
  it('publishes nothing, says why, and leaves the command clean', async () => {
    // A checkout of its own: the root config is read once per repository and process.
    const ci = join(home, 'kept-here');
    await git(home, 'init', '--quiet', ci);
    await writeFile(join(ci, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } }, share: GIT_SHARE }));
    const why = 'the suite "unit" is not given to the share; its "carry" in the root config is not "share"';

    expect(await publishSuite(ci, 'unit', { env: PUSH })).toEqual({ none: why });
    expect(await suiteShare(ci, { suite: 'unit', publish: true }, { env: PUSH })).toEqual({ lines: [`nothing published: ${why}.`], exit: EXIT_CLEAN });
  });
});
