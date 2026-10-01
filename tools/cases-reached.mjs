#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import picomatch from 'picomatch';

/**
 * The cases a change reached, at the grain of a workspace package.
 *
 * A case runs this project's built packages in child processes — a Storybook
 * build, a Playwright CLI, an Rstest CLI — so nothing records which region of
 * which module a case entered, and `test:since` has no row to select it by. What
 * is known is what each case installs: its manifest names the workspace packages
 * it runs, and theirs name the ones they run in turn. A change reaches a case
 * when it touches the case itself or a package in that closure.
 *
 * Which files count as a change to a package is `changedFilePatterns` in
 * `.changeset/config.json`, the rule that already decides whether a pull request
 * owes a changeset: a test, a fixture or a README of a package changes nothing a
 * case loads. A path outside every workspace selects nothing only when it is
 * declared inert below; any other path — the lockfile, a root config, a build
 * script, the workflow — reaches every case, because nothing here can say which
 * case it does not reach.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Paths outside every workspace that no case loads or is built by.
 *
 * Prose, the published site, the backlog, and the repository's own rules. A
 * path that is not listed here and belongs to no workspace runs every case.
 */
export const INERT = [
  '*.md',
  'LICENSE',
  '.agents/**',
  '.changeset/**',
  '.compass/**',
  'backlog/**',
  'docs/**',
  'site/**',
  'tools/**/*.check.ts',
  'cases/README.md',
];

/** Every workspace the root manifest declares, by name, with its directory and manifest. */
export function workspacesOf(root = ROOT) {
  const { workspaces = [] } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const found = new Map();
  for (const pattern of workspaces) {
    if (!pattern.endsWith('/*')) throw new Error(`workspace pattern ${pattern} is not a directory of packages`);
    const group = pattern.slice(0, -2);
    if (!existsSync(join(root, group))) continue;
    for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
      const manifestPath = join(root, group, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      found.set(manifest.name, { dir: `${group}/${entry.name}`, manifest });
    }
  }
  return found;
}

/**
 * The workspace directories a case runs: its own requirements, development ones
 * included because a case is run rather than installed, then what each package
 * among them requires to run.
 */
export function closureOf(caseName, workspaces) {
  const dirs = new Set();
  const visit = (name, own) => {
    const workspace = workspaces.get(name);
    if (workspace === undefined || dirs.has(workspace.dir)) return;
    dirs.add(workspace.dir);
    const { dependencies, devDependencies, optionalDependencies, peerDependencies } = workspace.manifest;
    const required = [dependencies, optionalDependencies, peerDependencies, own ? devDependencies : undefined];
    for (const group of required) for (const next of Object.keys(group ?? {})) visit(next, false);
  };
  visit(caseName, true);
  return dirs;
}

/** Whether a path inside a package is a change to it, by `.changeset/config.json`. */
export function packageChange(root = ROOT) {
  const { changedFilePatterns = ['**'] } = JSON.parse(readFileSync(join(root, '.changeset/config.json'), 'utf8'));
  const included = changedFilePatterns.filter((pattern) => !pattern.startsWith('!'));
  const excluded = changedFilePatterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));
  const isIncluded = picomatch(included, { dot: true });
  const isExcluded = picomatch(excluded, { dot: true });
  return (relative) => isIncluded(relative) && !isExcluded(relative);
}

/**
 * The cases `changed` reached, and why: `whole` names the path that reached
 * every case, or is `undefined` when the selection is narrower than that.
 */
export function casesReached(changed, { workspaces, counts, inert = INERT }) {
  const cases = [...workspaces.values()].filter(({ dir }) => dir.startsWith('cases/'));
  const closures = new Map(cases.map(({ dir, manifest }) => [dir, closureOf(manifest.name, workspaces)]));
  const owners = [...workspaces.values()].map(({ dir }) => dir).sort((a, b) => b.length - a.length);
  const isInert = picomatch(inert, { dot: true });

  const reached = new Map();
  const reach = (dir, because) => {
    if (!reached.has(dir)) reached.set(dir, because);
  };
  for (const path of changed) {
    if (isInert(path)) continue;
    const owner = owners.find((dir) => path.startsWith(`${dir}/`));
    if (owner === undefined) {
      return { whole: path, reached: new Map(cases.map(({ dir }) => [dir, path])) };
    }
    const relative = path.slice(owner.length + 1);
    if (owner.startsWith('cases/')) {
      if (relative !== 'README.md') reach(owner, path);
      continue;
    }
    if (!counts(relative)) continue;
    for (const [dir, closure] of closures) if (closure.has(owner)) reach(dir, path);
  }
  const ordered = new Map([...reached].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { whole: undefined, reached: ordered };
}

function changedSince(base, root = ROOT) {
  const out = execFileSync('git', ['diff', '--name-only', '--no-renames', base, 'HEAD'], { cwd: root, encoding: 'utf8' });
  return out.split('\n').filter((line) => line !== '');
}

function main(argv) {
  const at = argv.indexOf('--since');
  const base = at === -1 ? undefined : argv[at + 1];
  const github = argv.includes('--format') && argv[argv.indexOf('--format') + 1] === 'github';
  const workspaces = workspacesOf();
  const all = [...workspaces.values()].map(({ dir }) => dir).filter((dir) => dir.startsWith('cases/')).sort();

  let selected;
  if (base === undefined) {
    console.error('cases: no base was given, so every case runs.');
    selected = all;
  } else {
    const changed = changedSince(base);
    const { whole, reached } = casesReached(changed, { workspaces, counts: packageChange() });
    if (whole !== undefined) {
      console.error(`cases: ${whole} belongs to no workspace and is not declared inert, so every case runs.`);
    } else if (reached.size === 0) {
      console.error(`cases: none of the ${changed.length} path(s) changed since ${base} reaches a case.`);
    } else {
      console.error(`cases: ${reached.size} of ${all.length} reached by the change since ${base}:`);
      for (const [dir, because] of reached) console.error(`  ${dir}  by ${because}`);
    }
    selected = [...reached.keys()];
  }

  if (github) {
    process.stdout.write(`cases=${JSON.stringify(selected)}\n`);
    process.stdout.write(`paths=${selected.join(' ')}\n`);
  } else {
    for (const dir of selected) process.stdout.write(`${dir}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
