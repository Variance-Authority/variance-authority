#!/usr/bin/env node
//
// Whether a pull request can change what the `site` check photographs.
//
// The check builds `site/`, serves it, and photographs every route its sitemap
// lists, which takes about twenty minutes. A change reaches it in one of two
// ways: it changes what the site is built from, or it changes what photographs
// it. Each is read out of this checkout rather than listed here, so a page that
// starts importing another README, or a package the CLI starts depending on,
// is in reach the moment it is committed:
//
// - **What the site is built from**: everything under `site/`, and every file
//   a module there loads from outside it, read by sense's module reader. That
//   is how `docs/` and the packages' READMEs come in, as `?raw` text.
// - **What photographs it**: the workspace packages the run loads, which are
//   the one holding the runner (`VARIANCE_RUNNER`, the command the variance
//   step runs), every workspace package a site module names, and everything
//   those depend on. A file in one of them counts when it counts as a change of
//   that package to changesets: `.changeset/config.json`'s
//   `changedFilePatterns` already says that a test, a fixture or a README is
//   not the package.
// - **What runs it**: this workflow, the actions it uses, this file, and the root's
//   install and build. These are written down, because nothing in the
//   repository says which of its files a workflow job runs; they are what the
//   job's own text names.
//
// The change is the pull request's whole, its merge commit against the base it
// merges into, not the last push: a test-only push to a branch that already
// changed a docs page still has that page to show. A push, a dispatch and the
// accept label always run, and so does a pull request whose change cannot be
// read. Not running is the claim that needs the evidence.
//
// Writes `observe` and `because` to `$GITHUB_OUTPUT`. Run by hand with a merge
// commit, `node tools/site-reach.mjs <commit>`, it prints what it would decide.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readModule } from '@variance-authority/sense/read';
import picomatch from 'picomatch';

/** The files of the job itself: the workflow, the two actions its steps use, and this. */
const MACHINERY = [
  '.github/workflows/variance.yml',
  '.github/actions/build/**',
  '.github/actions/variance/**',
  'tools/site-reach.mjs',
];

/** The root's install. Its build is read from `scripts.build`. */
const INSTALL = ['package.json', 'yarn.lock', '.yarnrc.yml', '.yarn/**', 'tsconfig.json', 'tsconfig.base.json'];

const MODULE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

const git = (root, ...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Every path a commit touched against its first parent, both sides of a move,
 * or `undefined` when there is no parent to compare against.
 *
 * On a pull request the checkout is GitHub's merge commit, whose first parent
 * is the base branch, so this is the whole of what merging would change.
 */
export function changedBy(root, commit) {
  try {
    git(root, 'rev-parse', '--verify', '--quiet', `${commit}^1`);
  } catch {
    return undefined;
  }
  return git(root, 'diff', '--name-only', '--no-renames', `${commit}^1`, commit)
    .split('\n')
    .filter(Boolean);
}

/** The workspace packages, by name, each with its directory and what it loads. */
function workspaces(root) {
  const found = new Map();
  for (const line of execFileSync('yarn', ['workspaces', 'list', '--json'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)) {
    const { location, name } = JSON.parse(line);
    if (location === '.') continue;
    const manifest = JSON.parse(readFileSync(resolve(root, location, 'package.json'), 'utf8'));
    found.set(name, {
      dir: location,
      loads: Object.keys({
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
        ...manifest.peerDependencies,
      }),
    });
  }
  return found;
}

/** The specifiers every tracked module under `site/` loads. */
function siteRequests(root) {
  const requests = [];
  for (const file of git(root, 'ls-files', '--', 'site').split('\n')) {
    if (!MODULE.test(file) || !existsSync(resolve(root, file))) continue;
    const read = readModule(file, readFileSync(resolve(root, file), 'utf8'));
    if (read.unknown?.includes('parse error')) throw new Error(`${file} could not be parsed`);
    for (const { value } of read.requests) requests.push({ file, value });
  }
  return requests;
}

/** The package a bare specifier names, or `null` for a relative one or a host's own. */
function packageOf(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Whether a change can reach the site, and the sentence that says why.
 *
 * `changed` is repository-relative paths; `runner` is the file the variance
 * step runs. Reads the checkout at `root` for everything else.
 */
export function siteReach(root, changed, runner) {
  const packages = workspaces(root);
  const requests = siteRequests(root);

  // Loaded from outside `site/`: a path, or a prefix for a specifier that
  // leaves its extension to the resolver.
  const loaded = [];
  const seeds = new Set();
  for (const { file, value } of requests) {
    const named = packageOf(value);
    if (named !== null) {
      if (packages.has(named)) seeds.add(named);
      continue;
    }
    const target = posix.normalize(posix.join(posix.dirname(file), value.replace(/\?.*$/, '')));
    if (!target.startsWith('site/') && !target.startsWith('../')) loaded.push({ target, by: file });
  }

  for (const [name, { dir }] of packages) {
    if (runner.startsWith(`${dir}/`)) seeds.add(name);
  }
  const run = new Set();
  for (const pending = [...seeds]; pending.length > 0; ) {
    const name = pending.pop();
    if (run.has(name)) continue;
    run.add(name);
    for (const next of packages.get(name).loads) if (packages.has(next)) pending.push(next);
  }
  // The deepest directory first, so `packages/sense/npm/x` is not `packages/sense`.
  const owners = [...packages].sort(([, a], [, b]) => b.dir.length - a.dir.length);

  const { changedFilePatterns = ['**'] } = JSON.parse(readFileSync(resolve(root, '.changeset/config.json'), 'utf8'));
  const counts = picomatch(
    changedFilePatterns.filter((pattern) => !pattern.startsWith('!')),
    { dot: true, ignore: changedFilePatterns.filter((pattern) => pattern.startsWith('!')).map((p) => p.slice(1)) },
  );
  const build = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts?.build ?? '';
  const job = picomatch([...MACHINERY, ...INSTALL], { dot: true });

  for (const file of changed) {
    if (file.startsWith('site/')) return { observe: true, because: `\`${file}\` is the site's own.` };
    const imported = loaded.find(({ target }) => file === target || file.startsWith(`${target}.`));
    if (imported) return { observe: true, because: `\`${imported.by}\` loads \`${file}\`.` };
    const owner = owners.find(([, { dir }]) => file.startsWith(`${dir}/`));
    if (owner) {
      const [name, { dir }] = owner;
      if (run.has(name) && counts(file.slice(dir.length + 1))) {
        return { observe: true, because: `\`${file}\` changes \`${name}\`, which the run loads.` };
      }
      continue;
    }
    if (job(file) || build.split(/\s+/).includes(file)) {
      return { observe: true, because: `\`${file}\` is part of the job that photographs the site.` };
    }
  }

  const which = changed.length === 1 ? 'its 1 changed file is' : `none of its ${changed.length} changed files is`;
  return {
    observe: false,
    because: `${which} built into the site, loaded by the run that photographs it, or part of its job.`,
  };
}

/** What the step decides, from the event and the commit it checked out. */
function decide(root, commit) {
  const event = process.env['GITHUB_EVENT_NAME'];
  if (event !== 'pull_request') return { observe: true, because: `a \`${event}\` always runs the site.` };
  if (process.env['VARIANCE_EVENT_ACTION'] === 'labeled') {
    return { observe: true, because: 'the accept label asks for this run by name.' };
  }
  try {
    const changed = changedBy(root, commit);
    if (changed === undefined) {
      return { observe: true, because: `\`${commit}\` has no parent to compare against, so the change cannot be read.` };
    }
    const runner = process.env['VARIANCE_RUNNER'];
    if (!runner) throw new Error('VARIANCE_RUNNER is not set');
    return siteReach(root, changed, runner);
  } catch (error) {
    return { observe: true, because: `the change could not be read: ${error.message}` };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(import.meta.dirname, '..');
  const { observe, because } = decide(root, process.argv[2] || 'HEAD');
  const output = process.env['GITHUB_OUTPUT'];
  if (output) {
    appendFileSync(output, `observe<<__variance__\n${observe}\n__variance__\n`);
    appendFileSync(output, `because<<__variance__\n${because}\n__variance__\n`);
  }
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  const sentence = observe ? `The site is observed: ${because}` : `The site is not observed: ${because}`;
  if (summary) appendFileSync(summary, `${sentence}\n`);
  console.log(observe ? sentence : `::notice title=site not observed::${because}`);
}
