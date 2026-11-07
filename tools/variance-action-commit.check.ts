import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * A committed store accepts by a commit: `commit-baselines` pushes what `accept`
 * promoted to the branch a person asked about. A pull request names that branch
 * as its head; a dispatch names it as the ref it ran on, and only when that ref
 * is a branch. Any other run has no branch a person asked about, and refuses.
 *
 * The step's script is run as the runner runs it, against a bare `origin`, with
 * its `env:` resolved from the `github` context of the run.
 */

const ACTION = resolve(import.meta.dirname, '../.github/actions/variance/action.yml');
const STEP = 'commit regenerated baselines';
const IMAGE = 'baselines/Button-chromium.png';
const RENDERED = 'the button as this run drew it';

interface Step {
  readonly name?: string;
  readonly run: string;
  readonly env: Readonly<Record<string, string>>;
}

/** The `github` context of a run, as far as the commit-back reads it. */
interface Run {
  readonly event_name: string;
  readonly head_ref: string;
  readonly ref_name: string;
  readonly ref_type: string;
}

const dispatch = (ref_name: string, ref_type: string): Run => ({ event_name: 'workflow_dispatch', head_ref: '', ref_name, ref_type });

const step = (): Step => {
  const action = parse(readFileSync(ACTION, 'utf8')) as { runs: { steps: readonly Step[] } };
  const found = action.runs.steps.find((one) => one.name === STEP);
  if (found === undefined) throw new Error(`the action has no step ${STEP}`);
  return found;
};

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();

describe('the commit-back', () => {
  let at = '';
  beforeEach(async () => { at = await mkdtemp(join(tmpdir(), 'variance-action-commit-')); });
  afterEach(async () => { await rm(at, { recursive: true, force: true }); });

  /** A bare `origin` holding `feature`, and a checkout of it, as actions/checkout leaves a branch's run. */
  async function checkout(): Promise<{ readonly origin: string; readonly workspace: string }> {
    const origin = join(at, 'origin.git');
    const workspace = join(at, 'workspace');
    execFileSync('git', ['init', '--quiet', '--bare', origin]);
    execFileSync('git', ['clone', '--quiet', origin, workspace], { stdio: 'pipe' });
    await writeFile(join(workspace, 'README.md'), 'app');
    git(workspace, 'add', 'README.md');
    git(workspace, '-c', 'user.name=person', '-c', 'user.email=person@example.com', 'commit', '--quiet', '-m', 'app');
    git(workspace, 'checkout', '--quiet', '-b', 'feature');
    git(workspace, 'push', '--quiet', 'origin', 'feature');
    // What the run rendered, and an `accept` that promotes it, as the CLI does.
    await writeFile(join(at, 'rendered.png'), RENDERED);
    await writeFile(join(at, 'accept.sh'), `mkdir -p baselines && cp "${join(at, 'rendered.png')}" ${IMAGE}\n`);
    return { origin, workspace };
  }

  /** What the step printed and exited with, run in `workspace` for `run`. */
  async function commitBack(workspace: string, run: Run): Promise<{ readonly status: number; readonly out: string }> {
    const { env, run: script } = step();
    const context: Readonly<Record<string, string>> = { ...run };
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      const field = /^\$\{\{ github\.(\w+) \}\}$/u.exec(value)?.[1];
      if (field !== undefined) resolved[key] = context[field] ?? '';
    }
    try {
      const out = execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
        cwd: workspace,
        encoding: 'utf8',
        stdio: 'pipe',
        env: {
          ...process.env,
          ...resolved,
          VARIANCE_COMMAND: `bash ${join(at, 'accept.sh')}`,
          VARIANCE_CONFIG: 'variance.config.json',
          VARIANCE_BASELINES: join(workspace, 'baselines'),
          VARIANCE_PATHSPECS: ':(glob)baselines/*.png',
          VARIANCE_MESSAGE: 'chore(variance): regenerate baselines',
        },
      });
      return { status: 0, out };
    } catch (error) {
      const failed = error as { status: number; stdout: string; stderr: string };
      return { status: failed.status, out: `${failed.stdout}${failed.stderr}` };
    }
  }

  it('pushes what a dispatch on a branch accepted to that branch, where the next run finds the baseline it renders', async () => {
    const { origin, workspace } = await checkout();

    const first = await commitBack(workspace, dispatch('feature', 'branch'));

    expect(first.out).not.toContain('::error::');
    expect(first.status).toBe(0);
    expect(git(origin, 'show', `feature:${IMAGE}`)).toBe(RENDERED);
    // The next run on the branch: a fresh checkout of it holds what this run
    // renders, so its accept promotes nothing and the step commits nothing.
    const next = join(at, 'next');
    execFileSync('git', ['clone', '--quiet', '--branch', 'feature', origin, next], { stdio: 'pipe' });
    expect(await readFile(join(next, IMAGE), 'utf8')).toBe(RENDERED);
    const tip = git(origin, 'rev-parse', 'feature');
    const second = await commitBack(next, dispatch('feature', 'branch'));
    expect(second.out).toContain('no baseline changed; nothing to commit');
    expect(git(origin, 'rev-parse', 'feature')).toBe(tip);
  });

  it('pushes what a pull request accepted to its head branch', async () => {
    const { origin, workspace } = await checkout();

    const { status } = await commitBack(workspace, { event_name: 'pull_request', head_ref: 'feature', ref_name: '7/merge', ref_type: 'branch' });

    expect(status).toBe(0);
    expect(git(origin, 'show', `feature:${IMAGE}`)).toBe(RENDERED);
  });

  it('refuses a dispatch on a tag, saying a tag is no branch to push to, and pushes nothing', async () => {
    const { origin, workspace } = await checkout();
    const tip = git(origin, 'rev-parse', 'feature');

    const { status, out } = await commitBack(workspace, dispatch('v1.0.0', 'tag'));

    expect(status).toBe(2);
    expect(out).toContain('::error::commit-baselines runs on a pull_request event or a workflow_dispatch of a branch; this is a workflow_dispatch run on a tag');
    expect(git(origin, 'rev-parse', 'feature')).toBe(tip);
  });

  it('refuses a dispatch whose workspace is off its branch, naming the branch to check out', async () => {
    const { origin, workspace } = await checkout();
    git(workspace, 'checkout', '--quiet', '--detach');
    const tip = git(origin, 'rev-parse', 'feature');

    const { status, out } = await commitBack(workspace, dispatch('feature', 'branch'));

    expect(status).toBe(2);
    expect(out).toContain("::error::the workspace is on 'HEAD', not 'feature'; check out the branch 'feature' before enabling commit-baselines");
    expect(git(origin, 'rev-parse', 'feature')).toBe(tip);
  });

  it('refuses a push, which is on a branch but is no accept a person asked for', async () => {
    const { origin, workspace } = await checkout();
    const tip = git(origin, 'rev-parse', 'feature');

    const { status, out } = await commitBack(workspace, { event_name: 'push', head_ref: '', ref_name: 'feature', ref_type: 'branch' });

    expect(status).toBe(2);
    expect(out).toContain('this is a push run on a branch');
    expect(git(origin, 'rev-parse', 'feature')).toBe(tip);
  });
});
