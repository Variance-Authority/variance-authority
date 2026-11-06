import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { changedBy, siteReach } from './site-reach.mjs';

/**
 * The `site` check photographs the site's catalog and component pages, which
 * takes long enough to be worth skipping. Some pull requests cannot change one pixel of
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

// CI checks this repository out with every commit and no trees, and git
// fetches a tree it lacks from GitHub the moment a command reads one. A check
// that read an old commit's trees would wait on the network halfway through,
// so none does: a commit is made here, and git is told never to fetch.
const OFFLINE = { ...process.env, GIT_NO_LAZY_FETCH: '1' };

const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv = OFFLINE, input?: string): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env, input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();

const IDENTITY = ['-c', 'user.name=site-reach', '-c', 'user.email=site-reach@localhost', '-c', 'commit.gpgsign=false'];

/** A repository of its own, and a commit in it that writes `files`. */
async function repository(): Promise<{ dir: string; commit: (files: Record<string, string | null>) => string }> {
  const dir = await mkdtemp(join(tmpdir(), 'site-reach-'));
  git(dir, ['init', '--quiet', '--initial-branch=main']);
  const commit = (files: Record<string, string | null>): string => {
    for (const [file, text] of Object.entries(files)) {
      if (text === null) git(dir, ['rm', '--quiet', file]);
      else {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), text);
        git(dir, ['add', file]);
      }
    }
    git(dir, [...IDENTITY, 'commit', '--quiet', '--no-verify', '--allow-empty', '-m', 'change']);
    return git(dir, ['rev-parse', 'HEAD']);
  };
  return { dir, commit };
}

/**
 * A pull request's merge commit on this checkout's `HEAD`, as GitHub checks
 * one out: its first parent is the base, here `HEAD`, its second the branch,
 * and its tree is `HEAD`'s with each of `files` edited. The objects go to a
 * directory of their own, which `env` lends git as an alternate, so nothing is
 * written into the checkout.
 */
async function pullRequest(files: string[]): Promise<{ merge: string; env: NodeJS.ProcessEnv }> {
  const dir = await mkdtemp(join(tmpdir(), 'site-reach-'));
  const common = git(ROOT, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const env = {
    ...OFFLINE,
    GIT_INDEX_FILE: join(dir, 'index'),
    GIT_OBJECT_DIRECTORY: join(dir, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(common, 'objects'),
  };
  mkdirSync(env.GIT_OBJECT_DIRECTORY);
  git(ROOT, ['read-tree', 'HEAD'], env);
  for (const file of files) {
    const [mode] = git(ROOT, ['ls-tree', 'HEAD', '--', file], env).split(' ');
    const text = `${git(ROOT, ['cat-file', 'blob', `HEAD:${file}`], env)}\n// edited\n`;
    const blob = git(ROOT, ['hash-object', '-w', '--stdin'], env, text);
    git(ROOT, ['update-index', '--cacheinfo', `${mode},${blob},${file}`], env);
  }
  const tree = git(ROOT, ['write-tree'], env);
  const branch = git(ROOT, [...IDENTITY, 'commit-tree', tree, '-p', 'HEAD', '-m', 'branch'], env);
  const merge = git(ROOT, [...IDENTITY, 'commit-tree', tree, '-p', 'HEAD', '-p', branch, '-m', 'merge'], env);
  return { merge, env: { GIT_NO_LAZY_FETCH: '1', GIT_ALTERNATE_OBJECT_DIRECTORIES: env.GIT_OBJECT_DIRECTORY } };
}

// The site's reach is read from the published source index, as the job reads
// it, so the index is published first, as the job publishes it.
beforeAll(() => {
  execFileSync('node', [join(ROOT, RUNNER), 'index'], { cwd: ROOT, env: OFFLINE, stdio: 'ignore' });
}, 120_000);

describe('what reaches the site', () => {
  it.each([
    ['its own source', 'site/app/layout.tsx'],
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
    const { observe, because } = await siteReach(ROOT, ['docs/specs/0091-a-suite-is-selected-by-a-machine.md', file], RUNNER);

    expect(observe).toBe(true);
    expect(because).toContain(file);
  });

  it.each([
    ['a spec', 'docs/specs/0091-a-suite-is-selected-by-a-machine.md'],
    // The pages that render these are prose, and leave the photographed set by
    // marking themselves excluded; the catalog pages that quote a lead are
    // photographed on `main`'s run, which every change reaches.
    ['a README a site page imports as text', 'packages/cli/README.md'],
    ['a docs page a site page imports as text', 'docs/across-dimensions.md'],
    ['a test of a package the run loads', 'packages/core/src/judge/ignore.test.ts'],
    ['a fixture of a package the run loads', 'packages/package/src/__fixtures__/workspace/package.json'],
    ['a package nothing in the run loads', 'packages/tribunal/src/index.ts'],
    ['an example', 'examples/kitchen-sink/src/browser.ts'],
    ['another workflow', '.github/workflows/check.yml'],
    ['an action the job does not use', '.github/actions/ripgrep/action.yml'],
    ['a repository check', 'tools/site-packages.check.ts'],
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
  // As #347's did: the branch added a changeset and dropped it again, while
  // its base moved on. Merging it changed the example and nothing else.
  it('is what merging brought in, not what each commit of the branch did', async () => {
    const { dir, commit } = await repository();
    commit({ 'examples/readme-case/README.md': 'a case\n', 'docs/index.md': 'docs\n' });
    git(dir, ['switch', '--quiet', '--create', 'branch']);
    commit({ '.changeset/a-change.md': '---\n---\n' });
    commit({ '.changeset/a-change.md': null, 'examples/readme-case/README.md': 'the case\n' });
    git(dir, ['switch', '--quiet', 'main']);
    commit({ 'docs/index.md': 'the docs\n' });
    git(dir, [...IDENTITY, 'merge', '--quiet', '--no-ff', '--no-verify', '-m', 'merge', 'branch']);

    expect(changedBy(dir, 'HEAD')).toEqual(['examples/readme-case/README.md']);
  });

  // A move out of a package the run loads changes that package, and only the
  // path it left says so.
  it('names both sides of a move', async () => {
    const { dir, commit } = await repository();
    const text = Array.from({ length: 20 }, (_, line) => `export const line${line} = ${line};\n`).join('');
    commit({ 'packages/core/src/moved.ts': text });
    const moved = commit({ 'packages/core/src/moved.ts': null, 'examples/kitchen-sink/src/moved.ts': text });

    expect(git(dir, ['diff', '--name-status', '-M', `${moved}^1`, moved])).toMatch(/^R100\t/);
    expect(changedBy(dir, moved)).toEqual(['examples/kitchen-sink/src/moved.ts', 'packages/core/src/moved.ts']);
  });

  it('is unknown for a commit with nothing to compare against', async () => {
    const { dir, commit } = await repository();

    expect(changedBy(dir, commit({ 'README.md': 'first\n' }))).toBeUndefined();
  });

  // In CI's container the checkout belongs to another user, and git refuses
  // it as dubious until it is trusted. Outside a repository it refuses the
  // same way: that is a failure, not a commit without a parent.
  it('is a failure when git refuses the checkout', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'site-reach-'));

    expect(() => changedBy(elsewhere, 'HEAD')).toThrow(/not a git repository/);
  });
});

async function decide(
  event: string,
  action: string,
  commit: string,
  objects: NodeJS.ProcessEnv = { GIT_NO_LAZY_FETCH: '1' },
): Promise<{ code: number | null; out: string; outputs: Record<string, string> }> {
  const dir = await mkdtemp(join(tmpdir(), 'site-reach-'));
  const output = join(dir, 'output');
  await writeFile(output, '', 'utf8');
  const child = spawn('node', [SCRIPT, commit], {
    cwd: ROOT,
    // `HOME` is where the job's global git config is, which is what trusts a
    // checkout another user owns, as in the merge queue's container. Without
    // it git refuses the checkout and the run is observed for that reason.
    env: {
      HOME: process.env['HOME'],
      PATH: process.env['PATH'],
      GITHUB_EVENT_NAME: event,
      GITHUB_OUTPUT: output,
      VARIANCE_EVENT_ACTION: action,
      VARIANCE_RUNNER: RUNNER,
      ...objects,
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
  // A script that could not read the change observes the site, which every
  // case expecting `true` would take for a decision.
  expect(out).not.toContain('site reach not decided');
  const outputs: Record<string, string> = {};
  for (const [, key, value] of (await readFile(output, 'utf8')).matchAll(
    /^(\w+)<<__variance__\n([\s\S]*?)\n__variance__$/gm,
  )) {
    outputs[key!] = value!;
  }
  return { code, out, outputs };
}

describe('whether the run observes the site', () => {
  const first = git(ROOT, ['rev-list', '--max-parents=0', 'HEAD']).split('\n')[0]!;

  // `main` is what every pull request is compared against, so it always runs.
  it.each([
    ['a push', 'push', ''],
    ['a dispatch', 'workflow_dispatch', ''],
    ['the accept label, which asks for the run by name', 'pull_request', 'labeled'],
    ['a pull request whose change cannot be read', 'pull_request', 'synchronize'],
  ])('on %s', async (_, event, action) => {
    const { code, out, outputs } = await decide(event, action, first);

    expect(code, out).toBe(0);
    expect(outputs['observe'], outputs['because']).toBe('true');
    expect(outputs['because']).not.toBe('');
  });

  // A merge like #347's, which changed an example's README and its test, and
  // one like #339's, which changed the site's navigation, each made on `HEAD`.
  it.each([
    [
      'an example',
      ['examples/readme-case/README.md', 'examples/readme-case/src/readme.chromium.test.ts'],
      'false',
      'none of its 2 changed files is',
    ],
    ['the site', ['site/app/components/DocsPage.tsx', 'site/app/navigation.ts'], 'true', '`site/app/components/DocsPage.tsx`'],
  ])('on a pull request that changes %s, by what it changes', async (_, files, observe, because) => {
    const { merge, env } = await pullRequest(files);
    const { code, out, outputs } = await decide('pull_request', 'synchronize', merge, env);

    expect(code, out).toBe(0);
    expect(outputs['observe'], outputs['because']).toBe(observe);
    expect(outputs['because']).toContain(because);
  });
});
