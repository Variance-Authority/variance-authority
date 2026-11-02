import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { keepPushed, movePushed, takePushed } from './carry-pushed.js';

/**
 * What a pull request's earlier push left, kept by `carry keep` and taken by
 * `carry take` as this checkout's own layer.
 *
 * The record names the commits its tests last ran at, and a selection diffs
 * each test from its commit. Those are the merge commits of earlier pushes:
 * GitHub moves `refs/pull/<n>/merge` on every push, so no ref a clone fetches
 * holds them, and they are fetched by name. A suite whose commits cannot all
 * be had is not taken, and the checkout reads the mainline's record as it
 * would with nothing carried.
 */

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function commitIn(repo: string, file: string, text: string): Promise<string> {
  await writeFile(join(repo, file), text);
  git(repo, 'add', file);
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', file);
  return git(repo, 'rev-parse', 'HEAD');
}

/** An upstream, a clone of its `main`, and a commit only the upstream holds, by name and under no ref. */
async function pullRequest(): Promise<{ upstream: string; clone: string; kept: string; gone: string }> {
  const at = await mkdtemp(join(tmpdir(), 'carry-pushed-'));
  const upstream = join(at, 'upstream');
  await mkdir(upstream);
  git(upstream, 'init', '-q', '-b', 'main');
  git(upstream, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  await commitIn(
    upstream,
    'variance.config.json',
    JSON.stringify({ suites: { chromium: { kind: 'e2e' }, unit: { kind: 'unit' } } }),
  );
  const kept = await commitIn(upstream, 'a.ts', 'a\n');
  git(upstream, 'checkout', '-q', '-b', 'pull');
  const gone = await commitIn(upstream, 'b.ts', 'b\n');
  git(upstream, 'checkout', '-q', 'main');
  git(upstream, 'branch', '-q', '-D', 'pull');
  const clone = join(at, 'clone');
  git(at, 'clone', '-q', '--no-local', upstream, clone);
  return { upstream, clone, kept, gone };
}

async function carry(dir: string, suite: string, runs: object): Promise<void> {
  await mkdir(join(dir, suite), { recursive: true });
  await writeFile(join(dir, suite, 'coverage.bin'), 'carried');
  await writeFile(join(dir, suite, 'coverage.runs.json'), JSON.stringify(runs));
}

const LANDED = '2026-10-06T00:00:00.000Z';
const runsAt = (commit: string, standing: readonly string[] = []) => ({
  commit,
  latest: LANDED,
  runs: 1,
  landings: [{ files: ['a.test.ts'], first: LANDED, latest: LANDED, runs: 1 }],
  standing: standing.map((at) => ({ commit: at, files: ['b.test.ts'] })),
});

describe('a pull request reads from what its last push ran', () => {
  it('takes a suite whose commits the clone holds as its own layer', async () => {
    const { clone, kept } = await pullRequest();
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept));

    const taken = await takePushed(clone, carried);

    expect(taken).toEqual({ taken: ['unit'], left: [] });
    const own = testCoverageFile(clone, { suite: 'unit' });
    expect(readFileSync(own, 'utf8')).toBe('carried');
    expect(existsSync(join(dirname(own), 'coverage.runs.json'))).toBe(true);
  });

  it('fetches by name a commit a test stands on that no ref holds', async () => {
    const { clone, kept, gone } = await pullRequest();
    expect(() => git(clone, 'cat-file', '-e', `${gone}^{commit}`)).toThrow();
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept, [gone]));

    expect(await takePushed(clone, carried)).toEqual({ taken: ['unit'], left: [] });
    expect(git(clone, 'cat-file', '-t', gone)).toBe('commit');
  });

  it('leaves a suite whose commit the remote no longer has, and says which', async () => {
    const { clone, kept } = await pullRequest();
    const carried = join(clone, '.carried');
    const lost = 'f'.repeat(40);
    await carry(carried, 'unit', runsAt(kept, [lost]));
    await carry(carried, 'chromium', runsAt(kept));

    const taken = await takePushed(clone, carried);

    expect(taken.taken).toEqual(['chromium']);
    expect(taken.left).toEqual([{ suite: 'unit', missing: [lost] }]);
    expect(existsSync(testCoverageFile(clone, { suite: 'unit' }))).toBe(false);
  });

  it('leaves a suite whose record names no commit its tests ran at', async () => {
    const { clone } = await pullRequest();
    const carried = join(clone, '.carried');
    await mkdir(join(carried, 'unit'), { recursive: true });
    await writeFile(join(carried, 'unit', 'coverage.bin'), 'carried');

    expect(await takePushed(clone, carried)).toEqual({ taken: [], left: [{ suite: 'unit', unlisted: true }] });
    expect(existsSync(testCoverageFile(clone, { suite: 'unit' }))).toBe(false);
  });

  it('replaces the record a restore laid from the mainline, which the last push already stood on', async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, 'mainline');
    await writeFile(join(dirname(own), 'coverage.runs.json'), JSON.stringify(runsAt(kept)));
    await writeFile(join(dirname(own), 'stray'), 'mainline');
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept));

    const aside = join(carried, '.mainline', 'unit', 'coverage.bin');
    expect(await takePushed(clone, carried)).toEqual({ taken: ['unit'], left: [], against: { unit: aside } });
    expect(readFileSync(own, 'utf8')).toBe('carried');
    expect(existsSync(join(dirname(own), 'stray'))).toBe(false);
    // The review compares the change's cases with the mainline's, not the last push's.
    expect(readFileSync(aside, 'utf8')).toBe('mainline');
  });

  it('leaves the record a restore laid when the last push\'s cannot be taken', async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, 'mainline');
    const carried = join(clone, '.carried');
    const lost = 'f'.repeat(40);
    await carry(carried, 'unit', runsAt(kept, [lost]));

    expect((await takePushed(clone, carried)).left).toEqual([{ suite: 'unit', missing: [lost] }]);
    expect(readFileSync(own, 'utf8')).toBe('mainline');
  });

  it('keeps every suite this push recorded, with what a run left half-written left out', async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(join(dirname(own), '.run-1'), { recursive: true });
    await writeFile(own, 'this push');
    await writeFile(join(dirname(own), 'coverage.runs.json'), JSON.stringify(runsAt(kept)));
    await writeFile(join(dirname(own), '.run-1', 'part'), 'half');
    const pushed = join(clone, '.pushed');
    await carry(pushed, 'chromium', runsAt(kept));

    expect(await keepPushed(clone, pushed)).toEqual({ kept: ['unit'] });
    expect(readFileSync(join(pushed, 'unit', 'coverage.bin'), 'utf8')).toBe('this push');
    expect(existsSync(join(pushed, 'unit', '.run-1'))).toBe(false);
    // What an earlier push kept and this one did not record is not carried twice.
    expect(existsSync(join(pushed, 'chromium'))).toBe(false);
  });

  it('takes nothing when nothing was carried', async () => {
    const { clone } = await pullRequest();
    expect(await takePushed(clone, join(clone, '.nothing'))).toEqual({ taken: [], left: [] });
  });
});

describe('`carry take|keep` as a workflow step reads it', () => {
  const streams = () => {
    const said = { out: '', err: '' };
    return { said, streams: { out: (text: string) => void (said.out += text), err: (text: string) => void (said.err += text) } };
  };

  it('writes the taken suites and the mainline\'s record set aside as outputs, and the lines to the log', async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, 'mainline');
    const carried = join(clone, '.carried');
    await carry(carried, 'unit', runsAt(kept));
    await mkdir(join(carried, 'chromium'), { recursive: true });
    await writeFile(join(carried, 'chromium', 'coverage.bin'), 'carried');
    const { said, streams: to } = streams();

    await movePushed({ command: 'carry', direction: 'take', dir: carried, format: 'github' }, clone, to);

    const aside = join(carried, '.mainline', 'unit', 'coverage.bin');
    expect(said.out).toBe(`taken=unit\nleft=chromium\nagainst-unit=${aside}\n`);
    expect(said.err).toBe(
      `unit reads from what the last push ran. The mainline's record it replaced is at ${aside}, for \`review --against\`.\n` +
        "chromium reads the mainline's record: the last push's record has no runs record naming the commit it was recorded at.\n",
    );
  });

  it('writes the kept suites as an output, and to a person reading text says what it kept', async () => {
    const { clone, kept } = await pullRequest();
    const own = testCoverageFile(clone, { suite: 'unit' });
    await mkdir(dirname(own), { recursive: true });
    await writeFile(own, 'this push');
    await writeFile(join(dirname(own), 'coverage.runs.json'), JSON.stringify(runsAt(kept)));
    const pushed = join(clone, '.pushed');

    const github = streams();
    await movePushed({ command: 'carry', direction: 'keep', dir: pushed, format: 'github' }, clone, github.streams);
    expect(github.said).toEqual({ out: 'kept=unit\n', err: `kept unit in ${pushed}.\n` });

    const text = streams();
    await movePushed({ command: 'carry', direction: 'keep', dir: pushed, format: 'text' }, clone, text.streams);
    expect(text.said).toEqual({ out: `kept unit in ${pushed}.\n`, err: '' });
  });

  it('says nothing was carried, and keeps nothing when no suite recorded', async () => {
    const { clone } = await pullRequest();
    const { said, streams: to } = streams();
    await movePushed({ command: 'carry', direction: 'take', dir: join(clone, '.nothing'), format: 'text' }, clone, to);
    await movePushed({ command: 'carry', direction: 'keep', dir: join(clone, '.pushed'), format: 'text' }, clone, to);
    expect(said.out).toBe("no earlier push kept a record, so every suite reads the mainline's.\nthis push recorded no suite, so nothing is kept.\n");
  });
});
