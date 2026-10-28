import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { installDiff, installDiffOfPatch } from './installed.js';
import { diffPoint } from './since.js';

/**
 * Reading the install at a commit git resolves.
 *
 * A diff that touches every workspace's manifest — a version bump across a
 * monorepo — asks for each one at the base. The cost of that question is the
 * git processes it starts, so the gate counts them rather than timing them.
 */

const LOCK = '# yarn lockfile v1\n\n\nlodash@^4.17.21:\n  version "4.17.21"\n  resolved "https://example.test/lodash.tgz#a"\n  integrity sha512-a\n';

/** A repository of `count` workspaces, each manifest edited since the commit. */
function edited(count: number): { readonly repo: string; readonly changed: readonly string[] } {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'va-install-git-')));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  writeFileSync(join(repo, 'yarn.lock'), LOCK);
  const changed = Array.from({ length: count }, (_, at) => `packages/p${at}/package.json`);
  for (const file of changed) {
    mkdirSync(join(repo, file, '..'), { recursive: true });
    writeFileSync(join(repo, file), JSON.stringify({ name: file, version: '1.0.0' }));
  }
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  for (const file of changed) writeFileSync(join(repo, file), JSON.stringify({ name: file, version: '1.0.1', type: 'module' }));
  return { repo, changed };
}

/** The argv of every git process `run` started. */
async function gitStarted(repo: string, run: () => Promise<unknown>): Promise<string[][]> {
  const trace = join(repo, '.git', 'variance-trace.json');
  rmSync(trace, { force: true });
  vi.stubEnv('GIT_TRACE2_EVENT', trace);
  try {
    await run();
  } finally {
    vi.unstubAllEnvs();
  }
  const lines = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n') : [];
  return lines
    .map((line) => JSON.parse(line) as { event: string; argv?: string[] })
    .filter((event) => event.event === 'start')
    .map((event) => event.argv ?? []);
}

describe('the install at a commit, read through git', () => {
  async function compared(count: number) {
    const { repo, changed } = edited(count);
    const point = await diffPoint('HEAD', [], repo);
    let diff: Awaited<ReturnType<typeof installDiff>>;
    const started = await gitStarted(repo, async () => {
      diff = await installDiff(point, changed, repo);
    });
    return { started, diff: diff!, changed };
  }

  it('reads twenty changed manifests in as many git processes as two', async () => {
    const few = await compared(2);
    const many = await compared(20);

    expect(few.started.length).toBeGreaterThan(0);
    expect(many.started.length).toBe(few.started.length);
  });

  it('reads each manifest at the commit, so each one whose `type` moved is carried', async () => {
    const { diff, changed } = await compared(20);

    expect(diff).toEqual({ lockfile: 'yarn.lock', packages: [], manifests: ['yarn.lock', 'package.json'], moved: changed });
  });
});

describe('the install a patch names, read through git', () => {
  /** The git processes reading a patch of `count` staged manifests started, and its answer. */
  async function patched(count: number) {
    const { repo, changed } = edited(count);
    execFileSync('git', ['-C', repo, 'add', '.']);
    const patch = execFileSync('git', ['-C', repo, 'diff', '--cached', 'HEAD'], { encoding: 'utf8' });
    let diff: Awaited<ReturnType<typeof installDiffOfPatch>>;
    const started = await gitStarted(repo, async () => (diff = await installDiffOfPatch(patch, repo)));
    return { started, diff: diff!, changed };
  }

  // Each end of each manifest was a `git cat-file` of its own, all started at once.
  it('reads twenty patched manifests in as many git processes as two', async () => {
    const few = await patched(2);
    const many = await patched(20);

    expect(few.started.length).toBeGreaterThan(0);
    expect(many.started.length).toBe(few.started.length);
  });

  it('reads each manifest by its blob names, so each one whose `type` moved is carried', async () => {
    const { diff, changed } = await patched(20);

    // A patch lists its files in git's path order.
    expect(diff).toEqual({ packages: [], manifests: ['package.json'], moved: [...changed].sort() });
  });
});
