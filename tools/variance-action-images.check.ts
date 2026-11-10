import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * The action pushes a pull request's pictures to
 * `<prefix>/<project>/images/<head branch>`, so only the action knows what it
 * wrote, and `Variance-Authority/action/images` deletes it when the pull request
 * closes: every project's ref for that branch, and no other branch's.
 *
 * Its step is run as the runner runs it, against a local bare repository that
 * stands for the pull request's own.
 */

const ROOT = resolve(import.meta.dirname, '..');
const ACTION = join(ROOT, '.github/actions/variance/action.yml');
const FOLDER = join(ROOT, '.github/actions/variance/images');
const PREFIX = 'refs/variance/project';
const REPOSITORY = 'owner/repo';

interface Step {
  readonly run: string;
  readonly env?: Readonly<Record<string, string>>;
}

const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

const git = (args: readonly string[], cwd?: string): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });

/** A repository holding `refs` on one commit, as the server the action pushed them to. */
async function remote(refs: readonly string[]): Promise<{ server: string; at: string }> {
  const at = await mkdtemp(join(tmpdir(), 'variance-action-images-'));
  made.push(at);
  const bare = join(at, `${REPOSITORY}.git`);
  git(['init', '-q', '--bare', bare]);
  const tree = git(['--git-dir', bare, 'hash-object', '-w', '-t', 'tree', '/dev/null']).trim();
  const commit = execFileSync('git', ['--git-dir', bare, 'commit-tree', tree, '-m', 'images'], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@a', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@a' },
  }).trim();
  for (const ref of refs) git(['--git-dir', bare, 'update-ref', ref, commit]);
  return { server: `file://${at}`, at };
}

const refsOn = (at: string): string[] =>
  git(['--git-dir', join(at, `${REPOSITORY}.git`), 'for-each-ref', '--format=%(refname)']).split('\n').filter(Boolean).sort();

/** The action's one step, its `${{ inputs.* }}` read from `inputs`, run on a pull request event from `head`, `closed` unless `event` says otherwise. */
async function closed(
  server: { server: string; at: string },
  head: { ref: string; repo: string | null },
  inputs: Readonly<Record<string, string>> = { 'image-ref-prefix': PREFIX, 'github-token': 'a-token' },
  event = 'closed',
): Promise<{ status: number; printed: string }> {
  const action = parse(readFileSync(join(FOLDER, 'action.yml'), 'utf8')) as { runs: { steps: readonly Step[] } };
  const [step] = action.runs.steps;
  if (step === undefined) throw new Error('the images action has no step');
  const env = Object.fromEntries(
    Object.entries(step.env ?? {}).map(([name, value]) => [
      name,
      value.replace(/\$\{\{\s*inputs\.([\w-]+)\s*\}\}/g, (_, input: string) => inputs[input] ?? ''),
    ]),
  );
  const path = join(server.at, 'event.json');
  await writeFile(
    path,
    JSON.stringify({ action: event, pull_request: { head: { ref: head.ref, repo: head.repo === null ? null : { full_name: head.repo } } } }),
  );
  try {
    const printed = execFileSync('/bin/bash', ['-c', step.run], {
      env: {
        ...process.env,
        ...env,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GITHUB_ACTION_PATH: FOLDER,
        GITHUB_EVENT_PATH: path,
        GITHUB_REPOSITORY: REPOSITORY,
        GITHUB_SERVER_URL: server.server,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, printed };
  } catch (error) {
    const { status, stdout, stderr } = error as { status: number; stdout: string; stderr: string };
    return { status, printed: `${stdout}${stderr}` };
  }
}

describe('Variance-Authority/action/images', () => {
  it("deletes every project's images for the closed branch, and keeps a branch under it", async () => {
    // `feature/x` under a third project, since git keeps no ref beside a ref
    // under its own name: `a/images/feature` and `a/images/feature/x` never
    // both exist.
    const server = await remote([
      `${PREFIX}/a/images/feature`,
      `${PREFIX}/b/images/feature`,
      `${PREFIX}/c/images/feature/x`,
      `${PREFIX}/a/images/other`,
      'refs/heads/feature',
    ]);

    const { status, printed } = await closed(server, { ref: 'feature', repo: REPOSITORY });

    expect(status).toBe(0);
    expect(refsOn(server.at)).toEqual(['refs/heads/feature', `${PREFIX}/a/images/other`, `${PREFIX}/c/images/feature/x`]);
    expect(printed).toContain(`deleted ${PREFIX}/a/images/feature`);
    expect(printed).toContain(`deleted ${PREFIX}/b/images/feature`);
  });

  it('deletes a ref whose name a URL would read otherwise, as git spells it', async () => {
    const server = await remote([`${PREFIX}/a%2Eb/images/fix/#1%2`, `${PREFIX}/a/images/fix/#1`]);

    expect((await closed(server, { ref: 'fix/#1%2', repo: REPOSITORY })).status).toBe(0);
    expect(refsOn(server.at)).toEqual([`${PREFIX}/a/images/fix/#1`]);
  });

  it('says so, and passes, when the branch never pushed an image', async () => {
    const server = await remote([`${PREFIX}/a/images/other`]);

    const { status, printed } = await closed(server, { ref: 'feature', repo: REPOSITORY });

    expect(status).toBe(0);
    expect(printed).toContain('nothing to delete');
    expect(refsOn(server.at)).toEqual([`${PREFIX}/a/images/other`]);
  });

  it("skips a fork's pull request with a line, since its run could push nothing here", async () => {
    const server = await remote([`${PREFIX}/a/images/feature`]);

    for (const repo of ['someone/repo', null]) {
      const { status, printed } = await closed(server, { ref: 'feature', repo });

      expect(status).toBe(0);
      expect(printed).toMatch(/fork/);
      expect(refsOn(server.at)).toEqual([`${PREFIX}/a/images/feature`]);
    }
  });

  it('deletes nothing on a pull request that is still open, where the action has just pushed', async () => {
    const server = await remote([`${PREFIX}/a/images/feature`]);

    const { status, printed } = await closed(server, { ref: 'feature', repo: REPOSITORY }, undefined, 'synchronize');

    expect(status).toBe(0);
    expect(printed).toMatch(/not closed/);
    expect(refsOn(server.at)).toEqual([`${PREFIX}/a/images/feature`]);
  });

  it('fails on a listing it could not read, rather than reading it as no images', async () => {
    const server = await remote([]);

    const { status } = await closed({ ...server, server: `file://${join(server.at, 'missing')}` }, { ref: 'feature', repo: REPOSITORY });

    expect(status).not.toBe(0);
  });
});

/** The `run:` of the action's step that pushes the pictures the comment shows. */
function publishStep(): string {
  const action = parse(readFileSync(ACTION, 'utf8')) as { runs: { steps: ReadonlyArray<Step & { readonly name?: string }> } };
  const step = action.runs.steps.find((candidate) => candidate.name === 'publish the images the comment shows');
  if (step === undefined) throw new Error('the action has no step that publishes the images');
  return step.run;
}

describe('the images the comment shows', () => {
  let at = '';
  beforeEach(async () => { at = await mkdtemp(join(tmpdir(), 'variance-action-images-')); });
  afterEach(async () => { await rm(at, { recursive: true, force: true }); });

  /** Runs the step in the shell GitHub gives it, errexit and all, pushing to a bare `origin`. */
  async function published(repository: string): Promise<{ readonly origin: string; readonly output: string; readonly printed: string }> {
    const report = join(at, 'report');
    await mkdir(report, { recursive: true });
    await writeFile(join(report, 'report.json'), JSON.stringify({ observations: [{ images: { change: 'card.png' } }, { images: { change: '../out.png' } }] }));
    await writeFile(join(report, 'card.png'), 'png');
    await writeFile(join(report, 'unnamed.png'), 'png');
    const origin = join(at, 'origin.git');
    execFileSync('git', ['init', '--quiet', '--bare', origin]);
    // Two levels under the checkout, as a runner's workspace sits under the folder that holds the actions.
    const workspace = join(ROOT, 'work', 'repository');
    const run = publishStep()
      .replaceAll('${{ github.action_path }}', dirname(ACTION))
      .replaceAll('${{ github.workspace }}', workspace);
    await writeFile(join(at, 'output'), '');
    const printed = execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', run], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        GITHUB_TOKEN: 'token',
        GITHUB_SERVER_URL: `file://${at}`,
        GITHUB_REPOSITORY: repository,
        GITHUB_OUTPUT: join(at, 'output'),
        GITHUB_WORKSPACE: workspace,
        VARIANCE_REPORT: join(report, 'report.json'),
        VARIANCE_IMAGE_REF_PREFIX: 'refs/variance',
        VARIANCE_PROJECT: 'web',
        VARIANCE_BRANCH: 'feature',
      },
    });
    return { origin, output: await readFile(join(at, 'output'), 'utf8'), printed };
  }

  it('pushes the pictures the report names, and nothing else, as a commit with no parent at the branch ref, and links it', async () => {
    const { origin, output } = await published('origin');

    const git = (...args: string[]) => execFileSync('git', ['--git-dir', origin, ...args], { encoding: 'utf8' }).trim();
    const commit = git('rev-parse', 'refs/variance/web/images/feature');
    expect(git('ls-tree', '--name-only', commit)).toBe('card.png');
    expect(git('rev-list', '--count', commit)).toBe('1');
    expect(output).toBe(`root=file://${at}/origin/raw/${commit}\n`);
  });

  it('warns and links nothing when the push is refused, as a fork\'s token is', async () => {
    const { output, printed } = await published('elsewhere');

    expect(printed).toContain('::warning');
    expect(output).toBe('');
  });
});
