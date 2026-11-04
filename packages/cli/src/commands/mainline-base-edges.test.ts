import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { frame, suiteEntry } from '../share-entries.js';
import { lineCellOf, type Env } from '../share-lines.js';
import { MISS_STANDS_MS, mainlineBase, mainlineMissed } from './mainline-base.js';
import { DISCOUNTS, GIT_SHARE, PUSH, collectedBoth, git, gitPublished, published, publishTo, ranWhole, recordIn } from './mainline-fixture.js';
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
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

/** A clone of `origin` with a cache of its own, and what `mainlineBase` asks of it. */
async function laptop(origin: string, ...clone: string[]) {
  const dir = join(home, 'clone');
  await git(home, 'clone', '--quiet', ...clone, clone.length === 0 ? origin : `file://${origin}`, dir);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'laptop-cache'));
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
  await publishedAt(ci, commit);
  return commit;
}

/** The record CI made at `commit` published to the mainline: that commit's job finishing, whenever it does. */
async function publishedAt(ci: string, commit: string): Promise<void> {
  const reader = process.env['VARIANCE_AUTHORITY_CACHE'];
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
  await git(ci, 'checkout', '--quiet', commit);
  await recordIn(ci, commit, ['test/total.test.ts'], [DISCOUNTS]);
  await ranWhole(testCoverageFile(ci, { suite: 'unit' }), commit);
  const done = await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) });
  await git(ci, 'checkout', '--quiet', 'main');
  if (reader === undefined) vi.unstubAllEnvs();
  else vi.stubEnv('VARIANCE_AUTHORITY_CACHE', reader);
  // The latest keeps a newer commit's record when that job finished first.
  expect(done).toMatchObject({ published: { atCommit: { kept: [commit] } } });
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

    expect(await base(NOW + MISS_STANDS_MS - 1)).toEqual({ suite: 'unit', mainline: 'main', miss: missed.miss, asked: at(NOW), selected: { mainline: 'main' } });
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
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
    const done = await publishSuite(ci, 'unit', { env: PUSH }, { collected: await collectedBoth(home) });
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', laptopCache);
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

  it('reads the record fetched here, and says why, when nothing names a mainline any more', async () => {
    const { ci, origin, first } = await gitPublished(home);
    // The configuration names no mainline, so `origin/HEAD` is all that names one, and deleting it leaves nothing.
    await writeFile(join(ci, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } }, share: { kind: 'git' } }));
    await git(ci, 'commit', '--quiet', '--all', '-m', 'the line is the remote\'s');
    await git(ci, 'push', '--quiet', 'origin', 'main');
    const { dir, base } = await laptop(origin);
    expect(await base(NOW)).toMatchObject({ commit: first, mainline: 'main', fetched: at(NOW) });
    await git(dir, 'remote', 'set-head', 'origin', '--delete');

    const kept = { commit: first, mainline: 'main', fetched: at(NOW) };
    expect(await base(NOW + 1)).toMatchObject({ ...kept, earlier: { unanswered: { kind: 'unconfigured' } } });
    const declared = declaredSuites(dir)?.find((one) => one.name === 'unit');
    expect(await mainlineBase(dir, declared, { env: LOCAL, fetch: 'never' })).toMatchObject({ ...kept, earlier: { reused: 'offline' } });
    expect(await suiteBase(dir, { suite: 'unit', env: LOCAL })).toMatchObject({ from: 'mainline', mainline: kept });
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

// Each mainline publish here also keeps its record at its commit: a push and a listing more apiece.
describe('a record fetched earlier, against this checkout\'s merge base with the mainline', { timeout: 15_000 }, () => {
  it('stands at the merge base a day later, with the line not asked', async () => {
    const { origin, first } = await gitPublished(home);
    const { base, reach, nowhere } = await laptop(origin);
    expect(await base(NOW)).toMatchObject({ commit: first, distance: 0, fetched: at(NOW) });
    await reach(nowhere);

    const kept = await base(NOW + DAY);

    expect(kept).toMatchObject({ commit: first, distance: 0, fetched: at(NOW), earlier: { reused: 'nearest' } });
  });

  it('past the merge base, asks the line, which keeps the record at the merge base', async () => {
    const { ci, origin, first } = await gitPublished(home);
    const next = await publishedNext(ci);
    const { dir, base, reach, nowhere } = await laptop(origin);
    expect(await base(NOW)).toMatchObject({ commit: next, distance: 0, fetched: at(NOW) });
    // A branch cut before the record: its merge base is one commit behind it.
    await git(dir, 'checkout', '--quiet', '-b', 'older', 'HEAD~1');

    const read = await base(NOW + DAY);
    expect(read).toMatchObject({ commit: first, distance: 0, fetched: at(NOW + DAY) });
    expect(read).not.toHaveProperty('earlier');
    await reach(nowhere);

    expect(await base(NOW + 2 * DAY)).toMatchObject({ commit: first, distance: 0, earlier: { reused: 'nearest' } });
  });

  it('behind the merge base, reads the nearest record published behind it, and asks on every read until the merge base\'s is', async () => {
    // Green main: every commit's job publishes its record, the merge base's
    // too once its job finishes, and a later commit's may finish first.
    const { ci, origin, first } = await gitPublished(home);
    const second = await pushed(ci);
    const third = await publishedNext(ci);
    const { dir, base } = await laptop(origin);
    await git(dir, 'checkout', '--quiet', '-b', 'older', second);

    // Not the latest, which is past the merge base and charges the branch with `third`.
    expect(await base(NOW)).toMatchObject({ commit: first, distance: 1, fetched: at(NOW) });
    await forgetLineAnswers(join(home, 'laptop-cache'));
    const again = await base(NOW + 60_000);
    expect(again).toMatchObject({ commit: first, distance: 1, fetched: at(NOW + 60_000) });
    expect(again).not.toHaveProperty('earlier');

    await publishedAt(ci, second);
    await forgetLineAnswers(join(home, 'laptop-cache'));
    const read = await base(NOW + 2 * 60_000);

    expect(read).toMatchObject({ commit: second, distance: 0, fetched: at(NOW + 2 * 60_000) });
    expect(third).not.toBe(second);
  });

  it('behind the merge base, passes over a record kept there by another suite\'s job', async () => {
    const { ci, origin, first, record } = await gitPublished(home);
    const second = await pushed(ci);
    // The web suite's job at `second` finished; the unit suite's has not.
    const cell = await lineCellOf({ share: GIT_SHARE, cacheRoot: join(home, 'ci-cache') } as unknown as Config, { cwd: ci });
    if (cell === undefined || !('load' in cell)) throw new Error(`no line cell: ${JSON.stringify(cell)}`);
    await publishLine(cell, { kind: 'mainline', name: 'main' }, [{ name: suiteEntry('web'), commit: second, bytes: frame([['coverage.bin', record]]) }], {
      descends: async () => true,
      image: async (digest) => { throw new Error(`no image ${digest}`); },
    });
    await publishedNext(ci);
    const { dir, base } = await laptop(origin);
    await git(dir, 'checkout', '--quiet', '-b', 'older', second);

    expect(await base(NOW)).toMatchObject({ commit: first, distance: 1, fetched: at(NOW) });
  });

  it('behind a newer format, says so rather than reading an older record', async () => {
    const { ci, origin, record } = await gitPublished(home);
    const second = await pushed(ci);
    const cell = await lineCellOf({ share: GIT_SHARE, cacheRoot: join(home, 'ci-cache') } as unknown as Config, { cwd: ci });
    if (cell === undefined || !('load' in cell)) throw new Error(`no line cell: ${JSON.stringify(cell)}`);
    await publishLine(cell, { kind: 'mainline', name: 'main' }, [{ name: 'suite-v2/unit', commit: second, bytes: frame([['coverage.bin', record]]) }], {
      descends: async () => true,
      image: async (digest) => { throw new Error(`no image ${digest}`); },
    });
    await pushed(ci);
    const { base } = await laptop(origin);

    expect(await base(NOW)).toMatchObject({ miss: { kind: 'newer' } });
  });

  it('past the merge base, reads the latest and asks on every read, so the merge base\'s record is read once it is published', async () => {
    const { ci, origin, first } = await gitPublished(home);
    const second = await pushed(ci);
    const third = await publishedNext(ci);
    // Neither is kept: the merge base's job has not finished, and the record behind it was purged.
    await git(origin, 'update-ref', '-d', `refs/variance/at/${first}/mainline/main`);
    const { dir, base } = await laptop(origin);
    await git(dir, 'checkout', '--quiet', '-b', 'older', second);
    expect(await base(NOW)).toMatchObject({ commit: third, distance: -1, fetched: at(NOW) });

    await publishedAt(ci, second);
    await forgetLineAnswers(join(home, 'laptop-cache'));

    expect(await base(NOW + 60_000)).toMatchObject({ commit: second, distance: 0, fetched: at(NOW + 60_000) });
  });

  it('is asked again on every read when this clone cannot count how far off the merge base it is', async () => {
    const { ci, origin, first } = await gitPublished(home);
    await pushed(ci);
    // Cut at the merge base: no walk behind it, and no distance to the record.
    const { base, reach, nowhere } = await laptop(origin, '--depth', '1');
    expect(await base(NOW)).toMatchObject({ commit: first, fetched: at(NOW) });
    await reach(nowhere);

    const read = await base(NOW + 60_000);

    expect(read).toMatchObject({ commit: first, fetched: at(NOW), earlier: { unanswered: { kind: 'unreachable' } } });
    expect(read).not.toHaveProperty('distance');
  });

  it('is asked again once the merge base moves past it, and on every read while it is behind', async () => {
    const { ci, origin, first } = await gitPublished(home);
    const { dir, base, reach, nowhere } = await laptop(origin);
    expect(await base(NOW)).toMatchObject({ commit: first, fetched: at(NOW) });
    await pushed(ci);
    await git(dir, 'pull', '--quiet', '--ff-only');

    const asked = await base(NOW + 60_000);
    expect(asked).toMatchObject({ commit: first, distance: 1, fetched: at(NOW + 60_000) });
    expect(asked).not.toHaveProperty('earlier');
    await reach(nowhere);

    const kept = await base(NOW + 2 * 60_000);

    expect(kept).toMatchObject({ commit: first, distance: 1, fetched: at(NOW + 60_000), earlier: { unanswered: { kind: 'unreachable' } } });
  });
});

describe('a record fetched earlier from a share that keeps the latest only', { timeout: 15_000 }, () => {
  it('stands past the merge base, because the line holds nothing nearer it', async () => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
    const { dir: ci, origin } = await published(home);
    const next = await pushed(ci);
    await recordIn(ci, next, ['test/total.test.ts'], [DISCOUNTS]);
    await publishTo(home, ci, next, PUSH, 'mainline main');
    const { dir, base } = await laptop(origin);
    expect(await base(NOW)).toMatchObject({ commit: next, distance: 0, fetched: at(NOW) });
    await git(dir, 'checkout', '--quiet', '-b', 'older', 'HEAD~1');

    const kept = await base(NOW + DAY);

    expect(kept).toMatchObject({ commit: next, distance: -1, fetched: at(NOW), earlier: { reused: 'nearest' } });
  });

  it('is asked once the merge base moves past it, and stands once asked there', async () => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
    const { dir: ci, origin, first } = await published(home);
    const { dir, base } = await laptop(origin);
    expect(await base(NOW)).toMatchObject({ commit: first, fetched: at(NOW) });
    await pushed(ci);
    await git(dir, 'pull', '--quiet', '--ff-only');

    const asked = await base(NOW + 60_000);
    expect(asked).toMatchObject({ commit: first, distance: 1, fetched: at(NOW + 60_000) });
    expect(asked).not.toHaveProperty('earlier');

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
  it('is refused in the operator\'s sentence, never read as a checkout that has recorded nothing', async () => {
    const { origin } = await gitPublished(home);
    const { dir } = await laptop(origin);
    const own = testCoverageFile(dir, { suite: 'unit' });
    await mkdir(dirname(dirname(own)), { recursive: true });
    await writeFile(dirname(own), '');

    await expect(suiteBase(dir, { env: LOCAL })).rejects.toThrow(/could not be reached: ENOTDIR/u);
  });
});

describe('`variance share --suite --publish` that cannot keep its record by commit', () => {
  it('wrote the latest, says what it could not keep, and fails the command', async () => {
    const { ci, origin } = await gitPublished(home, { publish: false });
    await writeFile(join(origin, 'hooks/update'), '#!/bin/sh\ncase "$1" in refs/variance/at/*) exit 1;; esac\n');
    await chmod(join(origin, 'hooks/update'), 0o755);

    const done = await suiteShare(ci, { suite: 'unit', publish: true, collected: await collectedBoth(home) }, { env: PUSH });

    expect(done.exit).toBe(EXIT_OPERATOR);
    expect(done.lines.join('\n')).toContain('stopped before it finished keeping records by commit');
    expect(await git(ci, 'ls-remote', 'origin', 'refs/variance/mainline/main')).not.toBe('');
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
