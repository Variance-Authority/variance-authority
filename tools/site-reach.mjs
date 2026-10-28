#!/usr/bin/env node
//
// Whether a pull request can change what the `site` check photographs.
//
// The check builds `site/`, serves it, and photographs the routes its sitemap
// lists that do not exclude themselves: the catalog and component pages, since
// every markdown page carries `data-variance-exclude`. It is the slowest check
// a pull request waits for. A change reaches it in one of three ways, and the
// first two are read out of this checkout rather than listed here, so a site
// module that starts importing a package, or a package the CLI starts
// depending on, is in reach the moment it is committed:
//
// - **What the site is built from**: everything under `site/`, and every file
//   the published source index says a file there reaches. That is the file graph
//   every other reach question here walks (`affectedBy`), and it is how the
//   routes collector and what it imports come in. `docs/` and the packages'
//   READMEs reach it too, as `?raw` text, and do not count: the pages that
//   render them are excluded, and the catalog pages that quote a lead are
//   photographed on `main`'s push run. A site module the reader could not
//   enumerate every import of is a change nobody can read, and runs.
// - **What photographs it**: the workspace packages the run loads, which are
//   the one holding the runner (`VARIANCE_RUNNER`, the command the variance
//   step runs), every one the site's configured collector reaches, and
//   everything those depend on. These are judged by package, not by import:
//   the run also loads the native scanner, the page-agent bundles and the
//   skills, which nothing imports. A file in one of them counts when it
//   counts as a change of that package to changesets: `.changeset/config.json`'s
//   `changedFilePatterns` already says that a test, a fixture or a README is not
//   the package.
// - **What runs it**: this workflow, the actions and the script its steps use,
//   the configs the job reads, this file, the root's checkout attributes and
//   install, and every file a step of the root build reaches. The first ones
//   are written down, because nothing in the repository says which of its
//   files a workflow job runs; they are what the job's own text names.
//
// The change is the pull request's whole, its merge commit against the base it
// merges into, not the last push: a test-only push to a branch that already
// changed a docs page still has that page to show. A push, a dispatch and the
// accept label always run, and so does a pull request whose change cannot be
// read. Not running is the claim that needs the evidence.
//
// Reads the source index `variance index` publishes; in CI that step runs first.
// Writes `observe` and `because` to `$GITHUB_OUTPUT`. To ask it by hand about a
// merge commit, from the root:
//
//   GITHUB_EVENT_NAME=pull_request VARIANCE_RUNNER=packages/cli/dist/bin.js \
//     node tools/site-reach.mjs <commit>

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME_EDGES, affectedBy, dependenciesOf, idOf, nodeAt, relationsOfFiles } from '@variance-authority/core/relate';
import { publishedSources } from '@variance-authority/sense';
import ciInfo from 'ci-info';
import picomatch from 'picomatch';

/**
 * The files of the job itself: the workflow, the actions and the script its
 * steps use, the configs those read, and this.
 */
const MACHINERY = [
  '.github/workflows/variance.yml',
  '.github/actions/build/**',
  '.github/actions/variance/**',
  '.github/scripts/variance-accept.mjs',
  '.changeset/config.json',
  'variance.config.json',
  'tools/site-reach.mjs',
];

/**
 * The words a root script runs, with each `yarn <script>` it calls read in its
 * place, so a build split into named halves is still every step of the build.
 */
function words(scripts, name, seen = new Set([name])) {
  const said = (scripts[name] ?? '').split(/\s+/);
  return said.flatMap((word, at) =>
    said[at - 1] === 'yarn' && Object.hasOwn(scripts, word) && !seen.has(word)
      ? words(scripts, word, new Set([...seen, word]))
      : [word],
  );
}

/** The root's checkout and install. Its build is read from `scripts.build`. */
const INSTALL = [
  '.gitattributes',
  '.yarn/**',
  '.yarnrc.yml',
  'package.json',
  'tsconfig.base.json',
  'tsconfig.json',
  'yarn.lock',
];

const git = (root, ...args) =>
  execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/**
 * Every path a commit touched against its first parent, both sides of a move,
 * or `undefined` when there is no parent to compare against. Any other answer
 * git refuses to give, an untrusted checkout among them, throws.
 *
 * On a pull request the checkout is GitHub's merge commit, whose first parent
 * is the base branch, so this is the whole of what merging would change.
 */
export function changedBy(root, commit) {
  try {
    git(root, 'rev-parse', '--verify', '--quiet', `${commit}^1`);
  } catch (error) {
    // `--quiet` makes a missing revision exit 1 and say nothing.
    if (error.status === 1) return undefined;
    throw new Error(`git could not read \`${commit}^1\`: ${String(error.stderr ?? error.message).trim()}`);
  }
  return git(root, 'diff', '-z', '--name-only', '--no-renames', `${commit}^1`, commit)
    .split('\0')
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

/**
 * The checkout's file graph, from the published source index, and the site
 * modules whose imports it could not all read.
 */
async function graphOf(root) {
  const read = await publishedSources(root, {
    ci: ciInfo.isCI,
    step: 'variance index',
    announce: (line) => process.stderr.write(`site-reach: ${line}\n`),
  });
  const unread = read.records
    .filter(({ file, unknown, unresolved }) =>
      file.startsWith('site/') && (unknown !== undefined || unresolved?.some((value) => value.startsWith('.'))),
    )
    .map(({ file, unknown }) => `\`${file}\`${unknown === undefined ? '' : ` (${unknown})`}`);
  return { relations: relationsOfFiles(read.records), unread };
}

/**
 * Whether a change can reach the site, and the sentence that says why.
 *
 * `changed` is repository-relative paths; `runner` is the file the variance
 * step runs. Reads the checkout at `root` and its published source index for
 * everything else.
 */
export async function siteReach(root, changed, runner) {
  const packages = workspaces(root);
  const { relations, unread } = await graphOf(root);
  if (unread.length > 0) throw new Error(`not every import of ${unread.join(', ')} could be read`);

  // The deepest directory first, so `packages/sense/npm/x` is not `packages/sense`.
  const owners = [...packages].sort(([, a], [, b]) => b.dir.length - a.dir.length);
  const ownerOf = (file) => owners.find(([, { dir }]) => file.startsWith(`${dir}/`))?.[0];

  // The run loads the runner's package, and every package the site's collector
  // reaches: the routes collector's runs a page agent in every page it
  // photographs, which it loads by path rather than by import.
  const { subjects } = JSON.parse(readFileSync(resolve(root, 'site/variance.config.json'), 'utf8'));
  const collector = idOf(relations, 'file', `site/${subjects?.collector ?? ''}`);
  if (collector === undefined) throw new Error('the source index holds no collector for `site/variance.config.json`');
  const sited = dependenciesOf(relations, [collector], { through: RUNTIME_EDGES });
  const seeds = new Set([...packages].filter(([, { dir }]) => runner.startsWith(`${dir}/`)).map(([name]) => name));
  for (const id of sited.nodes) {
    const node = nodeAt(relations, id);
    const name = node?.kind === 'package' ? node.name : node?.kind === 'file' ? ownerOf(node.name) : undefined;
    if (name !== undefined && packages.has(name)) seeds.add(name);
  }

  const run = new Set();
  for (const pending = [...seeds]; pending.length > 0; ) {
    const name = pending.pop();
    if (run.has(name)) continue;
    run.add(name);
    for (const next of packages.get(name).loads) if (packages.has(next)) pending.push(next);
  }
  const { changedFilePatterns = ['**'] } = JSON.parse(readFileSync(resolve(root, '.changeset/config.json'), 'utf8'));
  const counts = picomatch(
    changedFilePatterns.filter((pattern) => !pattern.startsWith('!')),
    { dot: true, ignore: changedFilePatterns.filter((pattern) => pattern.startsWith('!')).map((p) => p.slice(1)) },
  );
  const build = words(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts ?? {}, 'build');
  const job = picomatch([...MACHINERY, ...INSTALL], { dot: true });

  for (const file of changed) {
    if (file.startsWith('site/')) return { observe: true, because: `\`${file}\` is the site's own.` };
    const reached = affectedBy(relations, [file], { through: RUNTIME_EDGES }).files;
    // Markdown is text a page shows, and the pages that show it whole leave the
    // photographed set by excluding themselves.
    const page = file.endsWith('.md') ? undefined : reached.filter((path) => path.startsWith('site/')).sort()[0];
    if (page !== undefined) return { observe: true, because: `\`${page}\` reaches \`${file}\`.` };
    const owner = owners.find(([, { dir }]) => file.startsWith(`${dir}/`));
    if (owner) {
      const [name, { dir }] = owner;
      if (run.has(name) && counts(file.slice(dir.length + 1))) {
        return { observe: true, because: `\`${file}\` changes \`${name}\`, which the run loads.` };
      }
    }
    if (job(file)) return { observe: true, because: `\`${file}\` is part of the job that photographs the site.` };
    const step = reached.find((path) => build.includes(path)) ?? (build.includes(file) ? file : undefined);
    if (step !== undefined) {
      return { observe: true, because: `\`${file}\` changes \`${step}\`, a step of the root build.` };
    }
  }

  const which = changed.length === 1 ? 'its 1 changed file is not' : `none of its ${changed.length} changed files is`;
  return {
    observe: false,
    because: `${which} built into the site, loaded by the run that photographs it, or part of its job.`,
  };
}

/** What the step decides, from the event and the commit it checked out. */
async function decide(root, commit) {
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
    return await siteReach(root, changed, runner);
  } catch (error) {
    return { observe: true, because: `the change could not be read: ${error.message}`, failed: true };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = resolve(import.meta.dirname, '..');
  const { observe, because, failed } = await decide(root, process.argv[2] || 'HEAD');
  const output = process.env['GITHUB_OUTPUT'];
  if (output) {
    appendFileSync(output, `observe<<__variance__\n${observe}\n__variance__\n`);
    appendFileSync(output, `because<<__variance__\n${because}\n__variance__\n`);
  }
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  const sentence = observe ? `The site is observed: ${because}` : `The site is not observed: ${because}`;
  if (summary) appendFileSync(summary, `${sentence}\n`);
  if (failed) console.log(`::warning title=site reach not decided::${because}`);
  else console.log(observe ? sentence : `::notice title=site not observed::${because}`);
}
