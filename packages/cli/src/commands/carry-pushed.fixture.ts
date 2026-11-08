import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A pull request's pushes, as `carry keep` and `carry take` meet them in the tests. */

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export async function commitIn(repo: string, file: string, text: string): Promise<string> {
  await writeFile(join(repo, file), text);
  git(repo, 'add', file);
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', file);
  return git(repo, 'rev-parse', 'HEAD');
}

/** An upstream, a clone of its `main`, and a commit only the upstream holds, by name and under no ref. */
export async function pullRequest(): Promise<{ upstream: string; clone: string; kept: string; gone: string }> {
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

export async function carry(dir: string, suite: string, runs: object): Promise<void> {
  await mkdir(join(dir, suite), { recursive: true });
  await writeFile(join(dir, suite, 'coverage.bin'), 'carried');
  await writeFile(join(dir, suite, 'coverage.runs.json'), JSON.stringify(runs));
}

const LANDED = '2026-10-06T00:00:00.000Z';

export const runsAt = (commit: string, standing: readonly string[] = []) => ({
  commit,
  latest: LANDED,
  runs: 1,
  landings: [{ files: ['a.test.ts'], first: LANDED, latest: LANDED, runs: 1 }],
  standing: standing.map((at) => ({ commit: at, files: ['b.test.ts'] })),
});

/** What a command printed, by stream. */
export const streams = () => {
  const said = { out: '', err: '' };
  return { said, streams: { out: (text: string) => void (said.out += text), err: (text: string) => void (said.err += text) } };
};
