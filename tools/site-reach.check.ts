import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { changedBy, siteReach } from './site-reach.mjs';

/**
 * The `site` check photographs every route the site's sitemap lists, which
 * takes about twenty minutes. Some pull requests cannot change one pixel of
 * it: a spec, a test, an example, the review service. Those finish the check
 * once the install and the build have, and every other one runs it as before.
 *
 * Asked of this checkout, because the answer is this checkout's: which files
 * the site reaches, which workspace packages the run loads, and which of their
 * files count as a change are all read from it rather than written down here.
 * A file named below stands for its kind.
 */

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'tools/site-reach.mjs');
const RUNNER = 'packages/cli/dist/bin.js';

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// The site's reach is read from the published source index, as the job reads
// it, so the index is published first, as the job publishes it.
beforeAll(() => {
  execFileSync('node', [join(ROOT, RUNNER), 'index'], { cwd: ROOT, stdio: 'ignore' });
}, 120_000);

describe('what reaches the site', () => {
  it.each([
    ['its own source', 'site/app/layout.tsx'],
    ['a README a site page imports as text', 'packages/cli/README.md'],
    ['a docs page a site page imports as text', 'docs/across-dimensions.md'],
    ['a package the run loads', 'packages/core/src/judge/scope.ts'],
    ['a package the site imports', 'packages/route-collector/src/read.ts'],
    ['what decides which routes are photographed', 'packages/route-collector/src/sitemap.ts'],
    ['what the routes collector runs inside every page, by path', 'packages/route-collector/src/page-agent-entry.ts'],
    ['the scanner the run loads to name components', 'packages/sense/native/src/read.rs'],
    ['the workflow that runs it', '.github/workflows/variance.yml'],
    ['the action that photographs it', '.github/actions/variance/action.yml'],
    ['the script that decides whether the run accepts', '.github/scripts/variance-accept.mjs'],
    ['what counts as a change of a package', '.changeset/config.json'],
    ['the install', 'yarn.lock'],
    ['a step of the root build', 'tools/page-agents.mjs'],
  ])('%s', async (_, file) => {
    const { observe, because } = await siteReach(ROOT, ['backlog/tasks/unrelated.md', file], RUNNER);

    expect(observe).toBe(true);
    expect(because).toContain(file);
  });

  it.each([
    ['a spec', 'docs/specs/0091-a-suite-is-selected-by-a-machine.md'],
    ['a test of a package the run loads', 'packages/core/src/judge/ignore.test.ts'],
    ['a fixture of a package the run loads', 'packages/package/src/__fixtures__/workspace/package.json'],
    ['a package nothing in the run loads', 'packages/tribunal/src/index.ts'],
    ['an example', 'examples/kitchen-sink/src/browser.ts'],
    ['another workflow', '.github/workflows/check.yml'],
    ['an action the job does not use', '.github/actions/ripgrep/action.yml'],
    ['a repository check', 'tools/site-packages.check.ts'],
    ['a task', 'backlog/tasks/unrelated.md'],
    ['a changeset', '.changeset/a-change.md'],
  ])('not %s', async (_, file) => {
    const { observe, because } = await siteReach(ROOT, [file], RUNNER);

    expect(observe).toBe(false);
    expect(because).toContain('1 changed file is not');
  });

  it('not a change that changes nothing', async () => {
    expect((await siteReach(ROOT, [], RUNNER)).observe).toBe(false);
  });
});

describe('the change a commit makes', () => {
  // #347's branch added a changeset and dropped it again: merging it changed
  // the example and nothing else.
  it('is what merging brought in, not what each commit of the branch did', () => {
    expect(changedBy(ROOT, '39ffac1a44b46a97de23324b902bd126ccadd0d9')).toEqual([
      'examples/readme-case/README.md',
      'examples/readme-case/src/readme.chromium.test.ts',
    ]);
  });

  // A move out of a package the run loads changes that package, and only the
  // path it left says so.
  it('names both sides of a move', () => {
    const moved = git('log', '--diff-filter=R', '--no-merges', '--max-count=1', '--format=%H', 'HEAD');
    const [, from, to] = git('diff', '--name-status', '-M', '--diff-filter=R', `${moved}^1`, moved)
      .split('\n')[0]!
      .split('\t');

    expect(changedBy(ROOT, moved)).toEqual(expect.arrayContaining([from, to]));
  });

  it('is unknown for a commit with nothing to compare against', () => {
    const first = git('rev-list', '--max-parents=0', 'HEAD').split('\n')[0]!;

    expect(changedBy(ROOT, first)).toBeUndefined();
  });
});

async function decide(
  event: string,
  action: string,
  commit: string,
): Promise<{ code: number | null; out: string; outputs: Record<string, string> }> {
  const dir = await mkdtemp(join(tmpdir(), 'site-reach-'));
  const output = join(dir, 'output');
  await writeFile(output, '', 'utf8');
  const child = spawn('node', [SCRIPT, commit], {
    cwd: ROOT,
    env: {
      PATH: process.env['PATH'],
      GITHUB_EVENT_NAME: event,
      GITHUB_OUTPUT: output,
      VARIANCE_EVENT_ACTION: action,
      VARIANCE_RUNNER: RUNNER,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
  });
  const code = await new Promise<number | null>((done) => child.on('close', done));
  const outputs: Record<string, string> = {};
  for (const [, key, value] of (await readFile(output, 'utf8')).matchAll(
    /^(\w+)<<__variance__\n([\s\S]*?)\n__variance__$/gm,
  )) {
    outputs[key!] = value!;
  }
  return { code, out, outputs };
}

describe('whether the run observes the site', () => {
  const first = git('rev-list', '--max-parents=0', 'HEAD').split('\n')[0]!;

  // `main` is what every pull request is compared against, so it always runs.
  it.each([
    ['a push', 'push', ''],
    ['a dispatch', 'workflow_dispatch', ''],
    ['the accept label, which asks for the run by name', 'pull_request', 'labeled'],
    ['a pull request whose change cannot be read', 'pull_request', 'synchronize'],
  ])('on %s', async (_, event, action) => {
    const { code, out, outputs } = await decide(event, action, first);

    expect(code, out).toBe(0);
    expect(outputs['observe']).toBe('true');
    expect(outputs['because']).not.toBe('');
  });

  // Two merges from this repository's own history: #347 changed an example's
  // README and its test, #339 the site's styling.
  it.each([
    ['an example', '39ffac1a44b46a97de23324b902bd126ccadd0d9', 'false'],
    ['the site', 'b823fd3038dfc012f2552c000b6a2f7966c14073', 'true'],
  ])('on a pull request that changes %s, by what it changes', async (_, commit, observe) => {
    const { code, out, outputs } = await decide('pull_request', 'synchronize', commit);

    expect(code, out).toBe(0);
    expect(outputs['observe']).toBe(observe);
  });
});
