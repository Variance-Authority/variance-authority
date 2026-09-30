import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunReport } from '@variance-authority/report';
import { commitRunsFile, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import type { Config } from '../config.js';
import { parseShare } from '../config-share.js';
import type { Env } from '../share-lines.js';
import { ask, type AskRequest } from './ask.js';
import { reportsFor } from './report-read.js';
import { mainlineIndex, mainlineSuite, mainlinesOf, publishedLine, publishRun, shareLines } from './share.js';

/**
 * A run publishes to the line it belongs to, and a reader reads its mainline.
 *
 * Against a real repository with a bare `origin`, because every answer here is
 * git's: which branch is the mainline, which commit descends from which, and
 * how far a record is from the checkout reading it.
 */

const run = promisify(execFile);

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-share-'));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'cache');
});

afterEach(async () => {
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

const PUSH: Env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main' };
const LOCAL: Env = {};

describe('which branches are mainlines', () => {
  it('is the config, then the branch the remote names, then the event, and never a guess', async () => {
    const repository = await repositoryOf(1);
    expect(await mainlinesOf(configOf({ root: home, mainlines: ['release', 'main'] }), LOCAL, repository.dir))
      .toEqual({ names: ['release', 'main'] });

    // A fetch by git 2.48 or later records the remote's HEAD itself; this one has none.
    await git(repository.dir, 'remote', 'set-head', 'origin', '--delete');

    expect(await mainlinesOf(configOf({}), LOCAL, repository.dir))
      .toEqual({ missing: ['config', 'remote-head', 'event'] });
    expect(await mainlinesOf(undefined, LOCAL, repository.dir))
      .toEqual({ missing: ['config', 'remote-head', 'event'] });

    const event = join(home, 'event.json');
    await writeFile(event, JSON.stringify({ repository: { default_branch: 'trunk' } }));
    expect(await mainlinesOf(configOf({}), { GITHUB_EVENT_PATH: event }, repository.dir)).toEqual({ names: ['trunk'] });

    await git(repository.dir, 'remote', 'set-head', 'origin', 'main');
    expect(await mainlinesOf(configOf({}), { GITHUB_EVENT_PATH: event }, repository.dir)).toEqual({ names: ['main'] });
  });
});

describe('publishing a run', () => {
  it('writes a push to the mainline, and a reader reads it back at its distance', async () => {
    const repository = await repositoryOf(3);
    const config = configOf({ root: join(home, 'share'), mainlines: ['main'] });

    const done = await publishRun(config, await reportAt(repository.commits[2]!), { env: PUSH, cwd: repository.dir });
    expect(done).toMatchObject({ line: { kind: 'mainline', name: 'main' }, published: { written: ['suite-index-v1'] } });

    await emptyLocalCache();
    const found = await mainlineIndex(config, { env: LOCAL, cwd: repository.dir });
    expect(found).toMatchObject({ mainline: 'main', commit: repository.commits[2], distance: 0, from: 'share' });
    expect('index' in found && found.index.subjects).toEqual(['page/footer']);

    // Kept on this machine, so the second read is a disk read.
    expect(await mainlineIndex(config, { env: LOCAL, cwd: repository.dir })).toMatchObject({ from: 'local' });
  });

  it('keeps a mainline record whose commit descends from the one offered', async () => {
    const repository = await repositoryOf(3);
    const config = configOf({ root: join(home, 'share'), mainlines: ['main'] });
    await publishRun(config, await reportAt(repository.commits[2]!), { env: PUSH, cwd: repository.dir });

    const late = await publishRun(config, await reportAt(repository.commits[1]!), { env: PUSH, cwd: repository.dir });
    expect(late).toMatchObject({
      published: { written: [], kept: [{ name: 'suite-index-v1', commit: repository.commits[2], because: 'newer-commit' }] },
    });
  });

  it('carries the report when the config gives it to the share', async () => {
    const repository = await repositoryOf(1);
    const config = { ...configOf({ root: join(home, 'share'), mainlines: ['main'] }), reportCarry: 'share' } as Config;

    const done = await publishRun(config, await reportAt(repository.commits[0]!), { env: PUSH, cwd: repository.dir });
    expect(done).toMatchObject({ published: { written: ['suite-index-v1', 'report-v1'] } });
  });

  it('carries a suite\'s record when the config gives it to the share, and a reader reads it back', async () => {
    const repository = await repositoryOf(2);
    const config = { ...configOf({ root: join(home, 'share'), mainlines: ['main'] }), suites: [{ name: 'unit', carry: 'share' }] } as Config;
    await writeFile(join(repository.dir, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
    const record = testCoverageFile(repository.dir, { suite: 'unit' });
    await mkdir(dirname(record), { recursive: true });
    await writeTestCoverage(record, { version: 3, instrumentation: 'fixture', commit: repository.commits[0]!, tests: [], modules: [] });
    await writeFile(`${record}.cases.bin`, 'cases');
    await writeFile(commitRunsFile(record), JSON.stringify({ commit: repository.commits[0], first: '', latest: '', runs: 1, files: [], standing: [] }));

    const done = await publishRun(config, await reportAt(repository.commits[0]!), { env: PUSH, cwd: repository.dir });
    expect(done).toMatchObject({ published: { written: ['suite-index-v1', 'suite-v1/unit'] } });
    expect(done).not.toHaveProperty('unpublished');

    const found = await mainlineSuite(config, 'unit', { env: LOCAL, cwd: repository.dir });
    expect(found).toMatchObject({ mainline: 'main', commit: repository.commits[0], distance: 1 });
    expect('coverage' in found && Buffer.from(found.coverage).equals(await readFile(record))).toBe(true);
    expect('coverage' in found && new TextDecoder().decode(found.cases)).toBe('cases');
    expect('coverage' in found && JSON.parse(new TextDecoder().decode(found.runs))).toMatchObject({ standing: [] });
    expect(await mainlineSuite(config, 'e2e', { env: LOCAL, cwd: repository.dir })).toEqual({ mainline: 'main', miss: { kind: 'absent' }, holds: ['suite-index-v1', 'suite-v1/unit'] });
  });

  it('leaves a suite\'s record out when it was recorded at another commit, and says so', async () => {
    const repository = await repositoryOf(2);
    const config = { ...configOf({ root: join(home, 'share'), mainlines: ['main'] }), suites: [{ name: 'unit', carry: 'share' }] } as Config;
    await writeFile(join(repository.dir, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
    const record = testCoverageFile(repository.dir, { suite: 'unit' });
    await mkdir(dirname(record), { recursive: true });
    await writeTestCoverage(record, { version: 3, instrumentation: 'fixture', commit: repository.commits[1]!, tests: [], modules: [] });

    const done = await publishRun(config, await reportAt(repository.commits[0]!), { env: PUSH, cwd: repository.dir });

    const why = `its record at ${record} was recorded at ${repository.commits[1]!}, not at ${repository.commits[0]!}`;
    expect(done).toMatchObject({ published: { written: ['suite-index-v1'] }, unpublished: [`suite-v1/unit: ${why}`] });
    const again = { ...config, share: configOf({ root: join(home, 'again'), mainlines: ['main'] }).share } as Config;
    expect(await shareLines(again, { publish: true, report: await reportAt(repository.commits[0]!) }, { env: PUSH, cwd: repository.dir })).toEqual([
      `wrote suite-index-v1 to mainline main in the directory ${join(home, 'again')}.`,
      `left out suite-v1/unit: ${why}.`,
    ]);
  });

  it('writes a branch line from a pull request, with the head it pointed at', async () => {
    const repository = await repositoryOf(1);
    const config = configOf({ root: join(home, 'share'), mainlines: ['main'] });
    const event = join(home, 'event.json');
    const repo = { full_name: 'acme/web' };
    await writeFile(event, JSON.stringify({ pull_request: { head: { sha: 'abcd', repo }, base: { repo } } }));
    const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'feat/x', GITHUB_EVENT_PATH: event };

    const done = await publishRun(config, await reportAt(repository.commits[0]!), { env, cwd: repository.dir });
    expect(done).toMatchObject({ line: { kind: 'branch', name: 'feat/x' }, published: { written: ['suite-index-v1'] } });
    expect(await readdir(join(home, 'share', 'branch'))).not.toEqual([]);
  });

  it('publishes nothing from a merge queue, a fork, another event on a mainline, or a mainline checkout', async () => {
    const repository = await repositoryOf(1);
    const config = configOf({ root: join(home, 'share'), mainlines: ['main'] });
    const report = await reportAt(repository.commits[0]!);
    const event = join(home, 'event.json');
    await writeFile(event, JSON.stringify({
      pull_request: { head: { sha: 'abcd', repo: { full_name: 'someone/web' } }, base: { repo: { full_name: 'acme/web' } } },
    }));

    const outcomes = await Promise.all([
      { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'merge_group' },
      { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'x', GITHUB_EVENT_PATH: event },
      { ...PUSH, GITHUB_EVENT_NAME: 'schedule' },
      LOCAL,
    ].map((env) => publishRun(config, report, { env, cwd: repository.dir })));
    expect(outcomes.map((outcome) => 'none' in outcome)).toEqual([true, true, true, true]);
  });

  it('publishes nothing from a report that names no commit, and keeps nothing either', async () => {
    const report = join(home, 'run.json');
    await writeFile(report, JSON.stringify({ ...reportOf('3f1c'), run: undefined }));
    expect(await publishRun(configOf({ root: join(home, 'share') }), report, { env: PUSH, cwd: home }))
      .toEqual({ none: 'this report names no commit' });
  });
});

describe('what a run and `variance share` say', () => {
  it('a run keeps its index and publishes nothing', async () => {
    const line = await publishedLine(configOf({ root: join(home, 'share') }), reportOf('3f1c'));
    expect(line).toMatch(/^suite index: .*3f1c\.bin\n$/);
    expect(await publishedLine(configOf({}), { ...reportOf('3f1c'), run: undefined })).toBe('');
  });

  it('names the line a publish wrote, and the mainline a reader read', async () => {
    const repository = await repositoryOf(2);
    const root = join(home, 'share');
    const config = configOf({ root, mainlines: ['main'] });
    const report = await reportAt(repository.commits[0]!);

    expect(await shareLines(config, { publish: true, report }, { env: PUSH, cwd: repository.dir }))
      .toEqual([`wrote suite-index-v1 to mainline main in the directory ${root}.`]);

    const read = await shareLines(config, { publish: false }, { env: LOCAL, cwd: repository.dir });
    expect(read[0]).toBe(
      `mainline main evaluated at ${repository.commits[0]!}, 1 commit(s) behind the merge base with this checkout, read from this machine.`,
    );
    expect(read[1]).toBe('1 subject(s), 1 component(s), lexicon over 1 field(s) of 1 subject(s)');
  });

  it('says why a reader found nothing', async () => {
    const repository = await repositoryOf(1);
    await git(repository.dir, 'remote', 'set-head', 'origin', '--delete');
    expect(await shareLines(configOf({}), { publish: false }, { env: LOCAL, cwd: repository.dir }))
      .toEqual(['no mainline: nothing answered from config, remote-head, event.']);
    expect(await shareLines(configOf({}), { publish: false, mainline: 'main' }, { env: LOCAL, cwd: repository.dir }))
      .toEqual(['mainline main: no share is configured.']);
    expect(await shareLines(configOf({ root: join(home, 'share') }), { publish: false, mainline: 'main' }, { env: LOCAL, cwd: repository.dir }))
      .toEqual(['mainline main: nothing is published there.']);
  });

  it('says a push with no mainline known went to its branch\'s line, and which answers were missing', async () => {
    const repository = await repositoryOf(1);
    await git(repository.dir, 'remote', 'set-head', 'origin', '--delete');
    const root = join(home, 'share');
    const report = await reportAt(repository.commits[0]!);

    expect(await shareLines(configOf({ root }), { publish: true, report }, { env: PUSH, cwd: repository.dir })).toEqual([
      `wrote suite-index-v1 to branch main in the directory ${root}.`,
      "no mainline: nothing answered from config, remote-head, event, so this run's line is branch main.",
    ]);
  });

  it('says nothing of the mainline for a pull request, whose line is its head branch whatever the mainline is', async () => {
    const repository = await repositoryOf(1);
    await git(repository.dir, 'remote', 'set-head', 'origin', '--delete');
    const root = join(home, 'share');
    const event = join(home, 'event.json');
    const repo = { full_name: 'acme/web' };
    await writeFile(event, JSON.stringify({ pull_request: { head: { sha: 'abcd', repo }, base: { repo } } }));
    const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'feat/x', GITHUB_EVENT_PATH: event };

    expect(await shareLines(configOf({ root }), { publish: true, report: await reportAt(repository.commits[0]!) }, { env, cwd: repository.dir }))
      .toEqual([`wrote suite-index-v1 to branch feat/x in the directory ${root}.`]);
  });

  it('says how many images the carried report names and this machine could not read, and names the first', async () => {
    const repository = await repositoryOf(1);
    const root = join(home, 'share');
    const written = join(home, 'ci');
    await mkdir(join(written, 'images'), { recursive: true });
    await writeFile(join(written, 'images', 'after.png'), 'pixels');
    const images = { before: 'images/before.png', after: 'images/after.png', diff: 'images/diff.png' };
    const observed = { subject: 'page/footer', verdict: 'changed', because: 'it changed', changedPixels: 1, regions: [], images };
    await writeFile(join(written, 'run.json'), JSON.stringify({ ...reportOf(repository.commits[0]!), observations: [observed] }));
    const config = carrying(configOf({ root, mainlines: ['main'] }));

    expect(await shareLines(config, { publish: true, report: join(written, 'run.json') }, { env: PUSH, cwd: repository.dir })).toEqual([
      `wrote suite-index-v1, report-v1 to mainline main in the directory ${root}.`,
      `left out 2 image(s) the report names and this machine could not read, the first at ${join(written, 'images', 'before.png')}.`,
    ]);
  });

  it('says nothing of the images a report left out when the line kept the report it holds', async () => {
    const repository = await repositoryOf(2);
    const root = join(home, 'share');
    const config = carrying(configOf({ root, mainlines: ['main'] }));
    const written = join(home, 'ci');
    await mkdir(written, { recursive: true });
    const images = { before: 'images/before.png' };
    const observed = { subject: 'page/footer', verdict: 'changed', because: 'it changed', changedPixels: 1, regions: [], images };
    await writeFile(join(written, 'run.json'), JSON.stringify({ ...reportOf(repository.commits[0]!), observations: [observed] }));
    await publishRun(config, await reportAt(repository.commits[1]!), { env: PUSH, cwd: repository.dir });

    const said = await shareLines(config, { publish: true, report: join(written, 'run.json') }, { env: PUSH, cwd: repository.dir });

    expect(said[0]).toBe(`nothing written to mainline main in the directory ${root}.`);
    expect(said.filter((line) => line.startsWith('left out'))).toEqual([]);
  });

  it('says a share token the environment does not hold is missing, and a run never asks for it', async () => {
    delete process.env['VARIANCE_TEST_SHARE_TOKEN'];
    const repository = await repositoryOf(1);
    const endpoint = 'http://127.0.0.1:9/share';
    const share = parseShare(
      { kind: 'http', endpoint, token: { env: 'VARIANCE_TEST_SHARE_TOKEN' }, mainlines: ['main'] },
      { source: 'variance.config.json', baseDir: home },
    );
    const config = { ...configOf({}), share } as Config;
    const unset =
      'variance.config.json: `share.token` names the environment variable "VARIANCE_TEST_SHARE_TOKEN", and it is not set. ' +
      'The config is right and the value is missing, so nothing was substituted here';

    expect(await publishedLine(config, reportOf(repository.commits[0]!))).toMatch(/^suite index: /);
    expect(await shareLines(config, { publish: true, report: await reportAt(repository.commits[0]!) }, { env: PUSH, cwd: repository.dir }))
      .toEqual([`nothing published to mainline main in the endpoint ${endpoint}: ${unset}.`]);
    expect(await shareLines(config, { publish: false }, { env: LOCAL, cwd: repository.dir })).toEqual([`mainline main: ${unset}.`]);
  });
});

describe('`variance ask` in a checkout with no report', () => {
  it('answers from the branch record, then the mainline record, and names the commit it read', async () => {
    const repository = await repositoryOf(2);
    const config = carrying(configOf({ root: join(home, 'share'), mainlines: ['main'] }));
    await publishRun(config, await reportAt(repository.commits[1]!), { env: PUSH, cwd: repository.dir });
    const head = await branchOf(repository.dir, 'feat/x');

    const fromMainline = await asked(config, repository.dir);
    expect(fromMainline).toMatch(new RegExp(
      `^report: read from mainline main, evaluated at ${repository.commits[1]!}, at the merge base with this checkout; ` +
        'kept at (.+)/report/[0-9a-f]{64}/run\\.json\\.\nbranch feat/x: nothing is published there\\.\n\n',
    ));

    await publishRun(config, await reportAt(head), { env: await pullRequest(head), cwd: repository.dir });
    const fromBranch = await asked(config, repository.dir);
    expect(fromBranch).toMatch(new RegExp(
      `^report: read from branch feat/x, evaluated at ${head} for pull request head ${head}, which is HEAD; kept at (.+)\\.\n\n`,
    ));

    // What was read is kept under the cache, and the question asked is recorded
    // beside it. The configured report is where this checkout's own run writes,
    // and nothing is ever written there.
    const kept = /kept at (.+)\.\n\n/.exec(fromBranch)![1]!;
    await expect(stat(join(dirname(kept), 'asked.json'))).resolves.toBeDefined();
    await expect(stat(config.report)).rejects.toMatchObject({ code: 'ENOENT' });

    await git(repository.dir, 'commit', '--quiet', '--allow-empty', '-m', 'one more');
    expect(await asked(config, repository.dir)).toContain(`for pull request head ${head}, 1 commit(s) before HEAD; kept at`);
  });

  it('says a branch record HEAD does not contain is another run of the branch', async () => {
    const repository = await repositoryOf(1);
    const config = carrying(configOf({ root: join(home, 'share'), mainlines: ['main'] }));
    const head = await branchOf(repository.dir, 'feat/x');
    await publishRun(config, await reportAt(head), { env: await pullRequest(head), cwd: repository.dir });

    // The branch was rebased: the record's commit is still in this clone, but not under HEAD.
    await git(repository.dir, 'checkout', '--quiet', '-B', 'feat/x', 'main');
    await git(repository.dir, 'commit', '--quiet', '--allow-empty', '-m', 'rebased');
    expect(await asked(config, repository.dir)).toContain(
      `evaluated at ${head} for pull request head ${head}, which this checkout does not contain: another run of feat/x, not this checkout's;`,
    );

    const elsewhere = 'e'.repeat(40);
    await publishRun(config, await reportAt(elsewhere), { env: await pullRequest(elsewhere), cwd: repository.dir });
    expect(await asked(config, repository.dir)).toContain(
      `evaluated at ${elsewhere} for pull request head ${elsewhere}, which this clone does not hold: read as another run of feat/x, not this checkout's;`,
    );
  });

  it('reads no branch line on a mainline, and fetches the images of the subject it is asked about', async () => {
    const repository = await repositoryOf(1);
    const config = carrying(configOf({ root: join(home, 'share'), mainlines: ['main'] }));
    const written = join(home, 'ci');
    await mkdir(join(written, 'images'), { recursive: true });
    await writeFile(join(written, 'images', 'footer.png'), 'pixels');
    const report = reportOf(repository.commits[0]!);
    const observed = { subject: 'page/footer', verdict: 'changed', because: 'it changed', changedPixels: 1, regions: [], images: { after: 'images/footer.png' } };
    await writeFile(join(written, 'run.json'), JSON.stringify({ ...report, observations: [observed] }));
    await publishRun(config, join(written, 'run.json'), { env: PUSH, cwd: repository.dir });

    const answer = await asked(config, repository.dir, { question: 'describe', subject: 'page/footer' });
    // On a mainline the branch is not asked, and an answer from it says nothing about one.
    expect(answer.split('\n').slice(0, 2)).toEqual([expect.stringMatching(/^report: read from mainline main, /), '']);
    const kept = /kept at (.+)\.\n/.exec(answer)![1]!;
    expect(await readFile(join(dirname(kept), 'images', 'footer.png'), 'utf8')).toBe('pixels');
  });

  it('refuses with every line it asked when none holds a report, and says so when no share is configured', async () => {
    const repository = await repositoryOf(1);
    await branchOf(repository.dir, 'feat/x');
    const config = carrying(configOf({ root: join(home, 'share'), mainlines: ['main'] }));
    const absent = `there is no run report at ${config.report}, which is where \`report\` in your configuration points`;

    await expect(asked(config, repository.dir)).rejects.toThrow(
      `${absent}, and the share holds none for this checkout:\n` +
        '  branch feat/x: nothing is published there\n' +
        '  mainline main: nothing is published there',
    );
    await expect(asked(configOf({}), repository.dir)).rejects.toThrow(
      `${absent}; \`variance run\` writes it there, and no share is configured to read CI's from`,
    );
  });
});

describe('a git share', () => {
  it('authenticates with the header your clone sends its remote, as a checkout on CI does', async () => {
    const seen: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      seen.push(request.headers['authorization']);
      response.writeHead(403).end();
    });
    await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
    try {
      const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/acme/web.git`;
      const repository = await repositoryOf(1);
      await git(repository.dir, 'remote', 'set-url', 'origin', url);
      await git(repository.dir, 'config', `http.${url}.extraheader`, 'AUTHORIZATION: basic c2VjcmV0');
      const config = { project: 'web', report: join(home, 'report.json'), share: { kind: 'git', mainlines: ['main'] } } as Config;

      expect(await mainlineIndex(config, { env: LOCAL, cwd: repository.dir }))
        .toMatchObject({ mainline: 'main', miss: { kind: 'refused' } });
      expect(seen).toContain('basic c2VjcmV0');
    } finally {
      server.close();
    }
  });
});

/** A question asked the way `dispatch` asks it: the configured report, read through `reportsFor`. */
async function asked(config: Config, cwd: string, rest: Partial<AskRequest> = {}): Promise<string> {
  return ask({ question: 'summary', report: config.report, read: () => reportsFor([], config), here: { env: LOCAL, cwd }, ...rest });
}

function carrying(config: Config): Config {
  return { ...config, reportCarry: 'share' } as Config;
}

/** Check out a new branch with one commit of its own, and return that commit. */
async function branchOf(dir: string, name: string): Promise<string> {
  await git(dir, 'checkout', '--quiet', '-b', name);
  await git(dir, 'commit', '--quiet', '--allow-empty', '-m', name);
  return git(dir, 'rev-parse', 'HEAD');
}

/** The environment of a pull request from `feat/x` whose head is `head`. */
async function pullRequest(head: string): Promise<Env> {
  const event = join(home, `event-${head}.json`);
  const repo = { full_name: 'acme/web' };
  await writeFile(event, JSON.stringify({ pull_request: { head: { sha: head, repo }, base: { repo } } }));
  return { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'feat/x', GITHUB_EVENT_PATH: event };
}

async function emptyLocalCache(): Promise<void> {
  process.env['VARIANCE_AUTHORITY_CACHE'] = await mkdtemp(join(home, 'cold-'));
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim();
}

/** A checkout of `main` with `commits` commits, all pushed to a bare `origin` and fetched back. */
async function repositoryOf(commits: number): Promise<{ dir: string; commits: string[] }> {
  const dir = await mkdtemp(join(home, 'repo-'));
  const origin = await mkdtemp(join(home, 'origin-'));
  await git(origin, 'init', '--bare', '--quiet');
  await git(dir, 'init', '--quiet', '-b', 'main');
  await git(dir, 'config', 'user.email', 'test@example.com');
  await git(dir, 'config', 'user.name', 'Test');
  await git(dir, 'remote', 'add', 'origin', origin);

  const made: string[] = [];
  for (let index = 0; index < commits; index += 1) {
    await git(dir, 'commit', '--quiet', '--allow-empty', '-m', `commit ${String(index)}`);
    made.push(await git(dir, 'rev-parse', 'HEAD'));
  }
  await git(dir, 'push', '--quiet', 'origin', 'main');
  await git(dir, 'fetch', '--quiet', 'origin');
  return { dir, commits: made };
}

function configOf(share: { root?: string; mainlines?: string[] }): Config {
  return {
    project: 'web',
    report: join(home, 'report.json'),
    ...(share.root === undefined
      ? {}
      : { share: { kind: 'directory', root: share.root, ...(share.mainlines ? { mainlines: share.mainlines } : {}) } }),
  } as Config;
}

async function reportAt(commit: string): Promise<string> {
  const path = join(home, `run-${commit}.json`);
  await writeFile(path, JSON.stringify(reportOf(commit)));
  return path;
}

function reportOf(commit: string): RunReport {
  return {
    runVersion: 1,
    identity: { renderer: 'playwright-chromium', engine: 'chromium@131', platform: 'linux/x64', deviceScaleFactor: 1, fonts: [] },
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
