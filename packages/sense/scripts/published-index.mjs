#!/usr/bin/env node

/**
 * What the published source index costs the step that writes it and the readers
 * that read it, on a checkout the size of the target.
 *
 * The corpus is Material UI, several times over in one checkout, built here so
 * anybody can build the same one: `git read-tree --prefix=copyN/` of one commit's
 * tree, once per copy, in a repository that borrows Material UI's objects through
 * `alternates`. No file is written twice to the object store, and every copy has
 * the same bytes, so seven copies are seven times the files and the same parses.
 * That is the shape a monorepo of vendored packages has, and it is the corpus
 * `docs/agent-workspace-api.md` measures search on.
 *
 * Every row is one process, so its peak RSS is its own, and it is the whole
 * operation a command performs:
 *
 * - `publish` — `updateSourceIndex` over the whole checkout: the `variance index` step.
 * - `read` — `publishedSources`, narrowed with `sourcesWithin` and tainted from the
 *   published parses: what every graph reader does now.
 * - `scan as reader` — open the index as a cache, scan from the root, taint and
 *   save: what every graph reader did before there was a step, each at its own scope.
 * - `worktree` — the first publish in a `git worktree` cut from the corpus, with
 *   the primary checkout's generation there to start from and without it.
 *
 * Edits are appended comments, made and reverted here; the corpus must be clean.
 *
 * Run:  node packages/sense/scripts/published-index.mjs {MATERIAL-UI} <corpus> [copies=7]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const SENSE = resolve(HERE, '../../dist/index.js');
const REPEATS = 3;

if (process.argv[2] === '--row') {
  await row(process.argv[3], process.argv[4], process.argv[5]);
} else {
  await main();
}

async function main() {
  const [source, corpusArg, copiesArg] = process.argv.slice(2);
  if (source === undefined || corpusArg === undefined) {
    console.error('usage: node packages/sense/scripts/published-index.mjs <material-ui> <corpus> [copies=7]');
    process.exit(2);
  }
  const corpus = resolve(corpusArg);
  const copies = Number(copiesArg ?? 7);
  const head = git(source, 'rev-parse', '--short', 'HEAD').trim();
  if (!existsSync(corpus)) build(source, corpus, copies);
  if (git(corpus, 'status', '--porcelain').trim() !== '') {
    console.error(`${corpus} has uncommitted changes; this script edits and reverts files in it`);
    process.exit(2);
  }

  const cache = mkdtempSync(join(tmpdir(), 'variance-published-index-'));
  const worktree = `${corpus}-worktree`;
  const env = { ...process.env, XDG_CACHE_HOME: cache };
  const tracked = git(corpus, 'ls-files').split('\n').filter(Boolean);
  const sources = tracked.filter((file) => /\/src\/.*\.js$/.test(file) && file.startsWith('copy1/')).sort();
  const one = ['copy1/packages/mui-material/src/Button/Button.js'];
  const hundred = sources.filter((_, index) => index % Math.max(1, Math.floor(sources.length / 100)) === 0)
    .slice(0, 100);

  console.log(`corpus: ${copies} copies of material-ui ${head}, ${tracked.length} tracked paths`);
  console.log(`node ${process.version}, ${process.platform} ${process.arch}; each row is ${REPEATS} processes, min-max\n`);
  const rows = [];
  const measure = (label, mode, root, index, before = () => {}) => {
    const runs = [];
    for (let i = 0; i < REPEATS; i += 1) {
      before();
      const child = spawnSync(process.execPath, [HERE, '--row', mode, root, index ?? ''], { env, encoding: 'utf8' });
      if (child.status !== 0) throw new Error(`${label}: ${child.stderr}`);
      runs.push(JSON.parse(child.stdout));
    }
    rows.push({ label, runs });
    console.log(format(label, runs));
  };
  const own = join(cache, 'scan-as-reader', 'source-index.bin');
  const drop = (path) => () => rmSync(join(path, '..'), { recursive: true, force: true });

  try {
    measure('publish, nothing published', 'publish', corpus, undefined, () => {
      rmSync(join(cache, 'variance-authority'), { recursive: true, force: true });
    });
    // TODO: time the stages of this row separately (tree listing, configuration
    // digest, the walk over held records, taint, save). It costs about what
    // a publish with a hundred edits costs, and nothing here says which stage is why.
    measure('publish, nothing moved', 'publish', corpus);
    edit(corpus, one);
    measure('publish, 1 file edited', 'publish', corpus);
    edit(corpus, hundred);
    measure(`publish, ${new Set([...one, ...hundred]).size} files edited`, 'publish', corpus);
    measure('read the publish', 'read', corpus);
    measure('scan as reader, no cache', 'scan', corpus, own, drop(own));
    measure('scan as reader, cache warm', 'scan', corpus, own);
    revert(corpus);

    git(corpus, 'worktree', 'add', '--quiet', '--detach', worktree);
    edit(worktree, one);
    const worktreeIndex = () => rmSync(join(cache, 'variance-authority', 'test-selection'), {
      recursive: true, force: true,
    });
    measure('worktree, first publish, primary published', 'publish', worktree, undefined, () => {
      rmSync(join(cache, 'variance-authority'), { recursive: true, force: true });
      spawnSync(process.execPath, [HERE, '--row', 'publish', corpus, ''], { env });
    });
    measure('worktree, first publish, nothing published', 'publish', worktree, undefined, worktreeIndex);
  } finally {
    revert(corpus);
    if (existsSync(worktree)) git(corpus, 'worktree', 'remove', '--force', worktree);
    rmSync(cache, { recursive: true, force: true });
  }
  writeFileSync(join(corpus, '..', 'published-index.json'), `${JSON.stringify(rows, null, 2)}\n`);
}

/** One operation in this process, printed as JSON with this process's peak RSS. */
async function row(mode, root, indexArg) {
  const sense = await import(SENSE);
  const index = indexArg === '' ? undefined : indexArg;
  const from = performance.now();
  let out;
  if (mode === 'publish') {
    const update = await sense.updateSourceIndex(root, index === undefined ? {} : { index });
    out = { was: update.was, files: update.files, reread: update.reread, seeded: update.from !== undefined };
  } else if (mode === 'read') {
    const published = await sense.publishedSources(root, {
      ci: true, step: 'variance index', announce() {}, ...(index === undefined ? {} : { index }),
    });
    const records = sense.sourcesWithin(published.records, root, ['.'], []);
    await sense.taintRecords(records, [sense.mockTaint()], { root, cache: published.cache });
    out = { files: records.length, layers: published.generation.length };
  } else if (mode === 'scan') {
    const source = await sense.openSourceIndex(index);
    const records = await sense.scanRelations({ root, dirs: ['.'], cache: source.cache, reuse: source.reuse });
    await sense.taintRecords(records, [sense.mockTaint()], { root, cache: source.cache });
    await source.save();
    out = { files: records.length };
  } else {
    throw new Error(`unknown row ${mode}`);
  }
  const ms = performance.now() - from;
  console.log(JSON.stringify({ ...out, ms: Math.round(ms), rssMb: Math.round(process.resourceUsage().maxRSS / 1024) }));
}

function build(source, corpus, copies) {
  git(source, 'rev-parse', '--git-dir');
  execFileSync('git', ['init', '--quiet', '-b', 'main', corpus]);
  const objects = resolve(source, git(source, 'rev-parse', '--git-path', 'objects').trim());
  writeFileSync(join(corpus, '.git', 'objects', 'info', 'alternates'), `${objects}\n`);
  const tree = git(source, 'rev-parse', 'HEAD^{tree}').trim();
  for (let copy = 1; copy <= copies; copy += 1) git(corpus, 'read-tree', `--prefix=copy${copy}/`, tree);
  git(corpus, '-c', 'user.name=corpus', '-c', 'user.email=corpus@localhost', 'commit', '--quiet',
    '-m', `${copies} copies of ${git(source, 'rev-parse', 'HEAD').trim()}`);
  git(corpus, 'checkout', '--quiet', '--force', 'HEAD');
}

function edit(root, files) {
  for (const file of files) appendFileSync(join(root, file), '\n// edited\n');
}

function revert(root) {
  git(root, 'checkout', '--quiet', '--', '.');
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
}

function format(label, runs) {
  const range = (key) => {
    const values = runs.map((run) => run[key]);
    if (values.some((value) => typeof value !== 'number')) return [...new Set(values)].join('/');
    const low = Math.min(...values);
    const high = Math.max(...values);
    return low === high ? `${low}` : `${low}-${high}`;
  };
  const facts = Object.keys(runs[0]).filter((key) => key !== 'ms' && key !== 'rssMb')
    .map((key) => `${key} ${range(key)}`).join(', ');
  return `${label.padEnd(46)} ${range('ms').padStart(11)} ms ${range('rssMb').padStart(11)} MB   ${facts}`;
}
