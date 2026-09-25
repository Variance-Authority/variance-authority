import { execFile } from 'node:child_process';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunReport } from '@variance-authority/report';
import type { Config } from '../config.js';
import {
  lineageOf,
  mainlineIndex,
  publishSuiteIndex,
  publishedLine,
  shareLines,
} from './share.js';

/**
 * What a share does when everything works, and what it does when nothing does.
 *
 * The second half is most of the file. Every failure a share can have — no
 * `git`, no ref, no share, an unwritable directory, bytes that decode to
 * nothing — has to end in the same place: the run derives its own index and
 * says so. A test suite that only covered the happy path would leave the one
 * property this module is built around unchecked.
 */

const run = promisify(execFile);

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-share-'));
  process.env['XDG_CACHE_HOME'] = home;
});

afterEach(() => {
  delete process.env['XDG_CACHE_HOME'];
});

describe('publishing what a run derived', () => {
  it('writes the index to this machine and offers it to the share', async () => {
    const root = join(home, 'share');
    const published = await publishSuiteIndex(configOf({ root }), reportOf('3f1c'));

    expect(published).toEqual({ commit: '3f1c', shared: true });
    expect(await readdir(join(root, 'web', 'suite-index-v1'))).toEqual(['3f1c.bin']);
  });

  it('keeps it locally when no share is configured', async () => {
    const published = await publishSuiteIndex(configOf({}), reportOf('3f1c'));

    expect(published).toEqual({ commit: '3f1c', shared: false });
  });

  it('publishes nothing from a report that names no commit', async () => {
    const report = reportOf('3f1c');
    const published = await publishSuiteIndex(configOf({}), { ...report, run: undefined });

    expect(published).toBeUndefined();
  });

  it('publishes nothing from a report with no composition', async () => {
    const report = reportOf('3f1c');
    expect(await publishSuiteIndex(configOf({}), { ...report, composition: undefined }))
      .toBeUndefined();
  });

  it('says where the bytes are, and nothing at all when there are none', async () => {
    const line = await publishedLine(configOf({ root: join(home, 'share') }), reportOf('3f1c'));
    expect(line).toMatch(/^suite index: .*3f1c\.bin \(published\)\n$/);

    const report = reportOf('3f1c');
    expect(await publishedLine(configOf({}), { ...report, run: undefined })).toBe('');
  });

  it('survives a share that cannot be reached', async () => {
    // A directory under a file. Every write into it fails, and the publish is
    // still the same publish: the local copy is written and nothing throws.
    const file = join(home, 'not-a-directory');
    await writeFile(file, 'x');

    expect(await publishSuiteIndex(configOf({ root: join(file, 'share') }), reportOf('3f1c')))
      .toEqual({ commit: '3f1c', shared: true });
  });
});

describe('the lineage a lookup walks', () => {
  it('is the commits the checkout descends from, newest first', async () => {
    const repository = await repositoryOf(3);
    const lineage = await lineageOf('HEAD', 50, repository.dir);

    expect(lineage).toEqual([...repository.commits].reverse());
  });

  it('stops at the depth it was given', async () => {
    const repository = await repositoryOf(3);
    expect(await lineageOf('HEAD', 1, repository.dir)).toEqual([repository.commits[2]]);
  });

  it('is empty where there is no repository, and where there is no such ref', async () => {
    const repository = await repositoryOf(1);

    expect(await lineageOf('HEAD', 50, home)).toEqual([]);
    expect(await lineageOf('origin/nothing', 50, repository.dir)).toEqual([]);
  });
});

describe('finding the newest mainline evaluation', () => {
  it('answers from the share, and says how far back it was', async () => {
    const repository = await repositoryOf(3);
    const root = join(home, 'share');
    const config = configOf({ root });

    // Published at the middle commit, so the answer is one behind the tip.
    await publishSuiteIndex(config, reportOf(repository.commits[1]!));
    await emptyLocalCache();

    const found = await mainlineIndex(config, { ref: 'HEAD', cwd: repository.dir });

    expect(found?.commit).toBe(repository.commits[1]);
    expect(found?.behind).toBe(1);
    expect(found?.from).toBe('share');
    expect(found?.index.subjects).toEqual(['page/footer']);
  });

  it('prefers what this machine already holds to what the share holds', async () => {
    const repository = await repositoryOf(2);
    const config = configOf({ root: join(home, 'share') });
    await publishSuiteIndex(config, reportOf(repository.commits[1]!));

    const found = await mainlineIndex(config, { ref: 'HEAD', cwd: repository.dir });

    expect(found?.from).toBe('local');
    expect(found?.behind).toBe(0);
  });

  it('finds nothing when nothing was published, and when there is no share at all', async () => {
    const repository = await repositoryOf(2);

    expect(await mainlineIndex(configOf({ root: join(home, 'share') }), {
      ref: 'HEAD',
      cwd: repository.dir,
    })).toBeNull();
    expect(await mainlineIndex(configOf({}), { ref: 'HEAD', cwd: repository.dir })).toBeNull();
  });

  it('treats bytes that are not an index as a miss', async () => {
    const repository = await repositoryOf(1);
    const config = configOf({ root: join(home, 'share') });
    await publishSuiteIndex(config, reportOf(repository.commits[0]!));
    await emptyLocalCache();
    // Under the right key, from a writer this reader does not understand.
    await writeFile(
      join(home, 'share', 'web', 'suite-index-v1', `${repository.commits[0]!}.bin`),
      'from a later version',
    );

    expect(await mainlineIndex(config, { ref: 'HEAD', cwd: repository.dir })).toBeNull();
  });

  it('finds nothing where there is no repository to ask about', async () => {
    expect(await mainlineIndex(configOf({ root: join(home, 'share') }), { cwd: home })).toBeNull();
  });
});

describe('what `variance share` says', () => {
  it('reports a publish, naming the share it reached', async () => {
    const root = join(home, 'share');
    const config = configOf({ root });
    const report = join(home, 'run.json');
    await writeFile(report, JSON.stringify(reportOf('3f1c')));

    const lines = await shareLines(config, { publish: true, report });

    expect(lines[0]).toMatch(/^suite index at 3f1c: /);
    expect(lines[1]).toBe(`offered to the directory ${root}`);
  });

  it('says a report naming no commit published nothing, and why', async () => {
    const report = join(home, 'run.json');
    const written = reportOf('3f1c');
    await writeFile(report, JSON.stringify({ ...written, run: undefined }));

    const lines = await shareLines(configOf({}), { publish: true, report });

    expect(lines[0]).toBe('nothing published: this report names no commit.');
  });

  it('reports a hit, its distance, and what it holds', async () => {
    // This repository, because a lookup walks the lineage of the checkout it
    // runs in and `shareLines` is the one entry point that does not take one.
    const { stdout } = await run('git', ['rev-parse', 'HEAD']);
    const config = configOf({ root: join(home, 'share') });
    await publishSuiteIndex(config, reportOf(stdout.trim()));

    const lines = await shareLines(config, { publish: false, ref: 'HEAD' });

    expect(lines[0]).toContain('the newest commit this tree descends from');
    expect(lines[1]).toBe('1 subject(s), 1 component(s), lexicon over 1 field(s) of 1 subject(s)');
  });

  it('reports a miss as the thing that happens next', async () => {
    const lines = await shareLines(configOf({}), { publish: false, ref: 'HEAD' });

    expect(lines).toEqual(['no share is configured; this run derives its own mainline evaluation.']);
  });
});

async function emptyLocalCache(): Promise<void> {
  // The share is asked only when this machine holds nothing. Publishing writes
  // both, so a test about the fetch has to take the local copy away first.
  process.env['XDG_CACHE_HOME'] = await mkdtemp(join(tmpdir(), 'variance-share-cold-'));
}

async function repositoryOf(commits: number): Promise<{ dir: string; commits: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'variance-share-repo-'));
  await run('git', ['init', '--quiet'], { cwd: dir });
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await run('git', ['config', 'user.name', 'Test'], { cwd: dir });

  const made: string[] = [];
  for (let index = 0; index < commits; index += 1) {
    await run('git', ['commit', '--quiet', '--allow-empty', '-m', `commit ${String(index)}`], {
      cwd: dir,
    });
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: dir });
    made.push(stdout.trim());
  }
  return { dir, commits: made };
}

function configOf(share: { root?: string }): Config {
  return {
    project: 'web',
    report: join(home, 'report.json'),
    ...(share.root === undefined ? {} : { share: { kind: 'directory', root: share.root } }),
  } as Config;
}

function reportOf(commit: string): RunReport {
  return {
    runVersion: 1,
    observations: [],
    run: { id: 'run-1', commit },
    composition: {
      subjects: ['page/footer'],
      components: [{
        component: 'TodoFooter',
        subjects: ['page/footer'],
        instances: 1,
        examples: ['page/footer'],
        within: [],
        createdBy: [],
        renders: [],
        tokens: [],
        variants: 1,
        renderings: 1,
      }],
    },
    lexicon: {
      version: 1,
      fields: ['components'],
      subjects: [{ subject: 'page/footer', boundaries: 1, terms: { components: ['TodoFooter'] } }],
    },
  } as unknown as RunReport;
}
