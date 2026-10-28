/**
 * A repository a history of edits, runs and selections is played through, and
 * the record those runs leave, read back from disk at every step.
 *
 * Carrying is two questions kept apart: did an edit change what a region does
 * (the reading), and which recorded region is a region of the newer text (the
 * correspondence). A defect in either shows only over a history: a cut that
 * lacked a callback, a comment that moved every line, a run of other tests
 * that carried the cases forward, and then an edit whose selection misses a
 * test. So a walk is a real git repository, a real record written by
 * `landRun`, and selections asked through the public readers, in-process or
 * through the CLI in a child process that opens the record cold.
 *
 * The subject is one file whose regions are labelled by the fixture: a
 * `hit('label')` call stands in the region it labels, and a test enters every
 * region a label it hits stands in. The module loads for every test a run
 * holds. What each test enters is the fixture's to say, so every expectation
 * is written from the labels, never read back from the code under test.
 *
 * A walk is removed only when it passes, so a failed one stays under
 * `CARRY_CONTRACT_ARTIFACTS`, with every text, the actions in order and each
 * expectation beside what came back written beside its record
 * ({@link keepArtifacts}), and its error names the directory.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { INSTRUMENTATION_ID, instrument } from '../../instrument/index.js';
import { caseSectionsAt } from '../case-record.js';
import { landRun } from '../commit-runs.js';
import { coverageBlocks, lineAt } from '../coverage-rows.js';
import { CrossingSets } from '../crossing-sets.js';
import { changedLines } from '../diff-lines.js';
import { narrowByJourneys } from '../execution-select.js';
import { decodeExecutionIndex } from '../execution-format.js';
import { encodeSetExecutionIndex } from '../execution-set-format.js';
import { NO_OWNER } from '../format-layout.js';
import { readTestCoverage, testCoverageFile, type CoverageBlock, type TestCoverage } from '../index.js';
import { readJourneyChange } from '../journey-reading.js';

const run = promisify(execFile);

/** The file every walk edits. */
export const SUBJECT = 'src/subject.ts';
/** A file only {@link runElsewhere}'s test enters, so a run can land without recording the subject. */
export const ELSEWHERE = 'src/elsewhere.ts';
/** The test {@link runElsewhere} runs. */
export const ELSEWHERE_TEST = 'test/elsewhere.test.ts';

/** The CLI's entry point, built. */
export const BIN = resolve(import.meta.dirname, '../../../../cli/dist/bin.js');

/** One step of a walk, as its artifacts list it. */
type Action = Readonly<Record<string, unknown>> & { readonly action: string };

export interface Walk {
  readonly root: string;
  readonly scratch: string;
  readonly coverageFile: string;
  readonly cacheRoot: string;
  /** Which labels each test hits: the fixture's ground truth. */
  readonly hits: Readonly<Record<string, readonly string[]>>;
  readonly actions: Action[];
  readonly checks: { readonly name: string; readonly expected: unknown; readonly actual: unknown }[];
  /** The subject's text at HEAD. */
  text: string;
  /** HEAD's commit. */
  head: string;
  /** The commit `variance index` last indexed into the walk's cache. */
  indexed?: string;
  /** Each text the subject held, in order. */
  readonly texts: string[];
}

/** A walk over a repository whose subject is `text`, committed, with the tests `hits` names. */
export async function openWalk(text: string, hits: Readonly<Record<string, readonly string[]>>): Promise<Walk> {
  // CI names a directory it uploads, so a failed walk outlives the runner.
  const parent = process.env['CARRY_CONTRACT_ARTIFACTS'] ?? tmpdir();
  await mkdir(parent, { recursive: true });
  const scratch = await realpath(await mkdtemp(resolve(parent, 'walk-')));
  const root = resolve(scratch, 'repository');
  const cacheRoot = resolve(scratch, 'cache');
  await mkdir(resolve(root, 'src'), { recursive: true });
  await mkdir(resolve(root, 'test'), { recursive: true });
  for (const test of [...Object.keys(hits), ELSEWHERE_TEST]) await writeFile(resolve(root, test), '', 'utf8');
  await writeFile(resolve(root, ELSEWHERE), 'export const elsewhere = 1;\n', 'utf8');
  await writeFile(resolve(root, SUBJECT), text, 'utf8');
  await git(root, 'init', '--quiet');
  await git(root, 'config', 'user.email', 'fixture@example.invalid');
  await git(root, 'config', 'user.name', 'Fixture');
  await git(root, 'add', '--all');
  await git(root, 'commit', '--quiet', '--message', 'the first text');
  return {
    root, scratch, cacheRoot, hits, text,
    head: (await git(root, 'rev-parse', 'HEAD')).trim(),
    coverageFile: testCoverageFile(root, { cacheRoot }),
    actions: [{ action: 'open', tests: hits }],
    checks: [],
    texts: [text],
  };
}

async function git(root: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })).stdout;
}

/**
 * Runs `body` over a walk, and removes the walk's directory when it passes;
 * when it throws, keeps the walk's artifacts and names the directory in the
 * error.
 */
export async function walking(
  text: string,
  hits: Readonly<Record<string, readonly string[]>>,
  body: (walk: Walk) => Promise<void>,
): Promise<void> {
  const walk = await openWalk(text, hits);
  try {
    await body(walk);
  } catch (error) {
    const kept = await keepArtifacts(walk);
    if (error instanceof Error) error.message = `${error.message}\nthe walk is kept at ${kept}`;
    throw error;
  }
  await rm(walk.scratch, { recursive: true, force: true });
}

/** Writes the walk's texts, actions and checks beside its repository and record; the directory they are in. */
export async function keepArtifacts(walk: Walk): Promise<string> {
  const into = resolve(walk.scratch, 'artifacts');
  await mkdir(into, { recursive: true });
  for (const [at, text] of walk.texts.entries()) await writeFile(resolve(into, `text-${at}.ts`), text, 'utf8');
  await writeFile(resolve(into, 'actions.json'), `${JSON.stringify(walk.actions, null, 2)}\n`, 'utf8');
  await writeFile(resolve(into, 'checks.json'), `${JSON.stringify(walk.checks, null, 2)}\n`, 'utf8');
  return walk.scratch;
}

/** Records an expectation beside what came back, so a kept walk shows both. */
export function noted<T>(walk: Walk, name: string, actual: T, expected: T): T {
  walk.checks.push({ name, expected, actual });
  return actual;
}

/** Writes `text` as the subject and commits it; the commit. */
export async function commit(walk: Walk, text: string, message: string): Promise<string> {
  await writeFile(resolve(walk.root, SUBJECT), text, 'utf8');
  await git(walk.root, 'add', '--all');
  await git(walk.root, 'commit', '--quiet', '--allow-empty', '--message', message);
  walk.text = text;
  walk.texts.push(text);
  walk.actions.push({ action: 'commit', message, text: walk.texts.length - 1 });
  walk.head = (await git(walk.root, 'rev-parse', 'HEAD')).trim();
  return walk.head;
}

/** A region of the subject's text as a run records it, with the labels that stand in it. */
interface Region {
  readonly block: Omit<CoverageBlock, 'testFiles'>;
  readonly labels: readonly string[];
}

/** The regions of `text`, each with the labels whose `hit` call stands in its lines. */
export function regionsOf(text: string): readonly Region[] {
  const blocks = coverageBlocks(instrument(text, SUBJECT, SUBJECT)!.blocks, {
    text,
    extentOf: (start, last) => [lineAt(text, start), lineAt(text, last)],
  });
  const labelled = [...text.matchAll(/hit\('([^']+)'\)/gu)].map((match) => ({ label: match[1]!, line: lineAt(text, match.index) }));
  return blocks.map(({ testFiles: _testFiles, ...block }) => ({
    block,
    labels: labelled
      .filter(({ line }) => block.startLine !== undefined && line >= block.startLine && line <= block.endLine!)
      .map(({ label }) => label),
  }));
}

/**
 * The region a label names: the innermost one its `hit` call stands in. The
 * module's own label is the one its top-level statement hits.
 */
export function labelOf(regions: readonly Region[], at: number): string | undefined {
  const ordinal = regions[at]!.block.ordinal;
  const byOrdinal = new Map(regions.map((region) => [region.block.ordinal, region]));
  const inside = (region: Region): boolean => {
    for (let owner = region.block.owner; owner !== undefined; owner = byOrdinal.get(owner)?.block.owner) {
      if (owner === ordinal) return true;
    }
    return false;
  };
  const nested = regions.filter(inside).flatMap((region) => region.labels);
  return regions[at]!.labels.find((label) => !nested.includes(label));
}

/** Whether `test` enters `region`: a label it hits stands in the region's lines. */
function enters(walk: Walk, test: string, region: Region): boolean {
  return region.block.kind === 'module' || region.labels.some((label) => walk.hits[test]!.includes(label));
}

export interface RunOptions {
  /**
   * Labels whose regions the run's cut lacks: a run that read the file through
   * two transforms keeps only the regions both cut alike. Each region lacked
   * hands what entered it to the region around it.
   */
  readonly lacks?: readonly string[];
  /**
   * A text the run is recorded over without committing it, as a run over a
   * dirty tree is: the landing finds it on disk, and the walk's tree is set
   * back to HEAD's text after.
   */
  readonly over?: string;
}

/** A run of `tests` over the subject at HEAD, landed into the walk's record. */
export async function runTests(walk: Walk, tests: readonly string[], options: RunOptions = {}): Promise<void> {
  const { head } = walk;
  const text = options.over ?? walk.text;
  const all = regionsOf(text);
  const lacked = new Set(all.flatMap((region, at) => {
    const label = labelOf(all, at);
    return label !== undefined && options.lacks?.includes(label) === true ? [region.block.ordinal] : [];
  }));
  const kept = all.filter((region) => !lacked.has(region.block.ordinal));
  const byOrdinal = new Map(all.map((region) => [region.block.ordinal, region]));
  // A lacked region's owner stands for it: whatever entered it entered the region around it.
  const keptOwner = (region: Region): number | undefined => {
    let owner = region.block.owner;
    while (owner !== undefined && lacked.has(owner)) owner = byOrdinal.get(owner)!.block.owner;
    return owner;
  };
  const entering = (region: Region): string[] => tests.filter((test) =>
    enters(walk, test, region)
      || all.some((inner) => lacked.has(inner.block.ordinal) && keptOwner(inner) === region.block.ordinal && enters(walk, test, inner)));
  const instrumented = instrument(text, SUBJECT, SUBJECT)!;
  const coverage: TestCoverage = {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit: head,
    tests: tests.map((file) => ({ file, complete: true, preconditions: [{ name: file, digest: `source:${file}` }] })),
    modules: [{
      file: SUBJECT,
      sourceDigest: instrumented.sourceDigest,
      instrumented: true,
      blocks: kept.map((region) => {
        const owner = keptOwner(region);
        const { owner: _owner, ...block } = region.block;
        return {
          ...block,
          ...(owner === undefined ? {} : { owner }),
          testFiles: entering(region).sort(),
          ...(region.block.kind === 'module' ? { loadedBy: [...tests].sort() } : {}),
        };
      }),
    }],
  };
  const sets = new CrossingSets(tests.length);
  sets.intern([]);
  const fresh = encodeSetExecutionIndex({
    tests: tests.map((file) => ({ id: caseOf(file), file, name: 'runs' })),
    modules: [{
      file: SUBJECT,
      blocks: kept.map(({ block }) => ({
        kind: block.kind, name: block.name, path: block.path, startLine: block.startLine!, endLine: block.endLine!, source: block.source,
      })),
      called: Uint32Array.from(kept, (region) => sets.intern(entering(region).map((test) => tests.indexOf(test)))),
      loaded: Uint8Array.from(kept, ({ block }) => (block.kind === 'module' ? 1 : 0)),
      owner: Uint32Array.from(kept, (region) => {
        const owner = keptOwner(region);
        return owner === undefined ? NO_OWNER : kept.findIndex((other) => other.block.ordinal === owner);
      }),
    }],
    sets: sets.pool(),
  });
  if (options.over !== undefined) walk.texts.push(options.over);
  walk.actions.push({ action: 'run', tests, ...(options.lacks === undefined ? {} : { lacks: options.lacks }), text: walk.texts.length - 1 });
  await writeFile(resolve(walk.root, SUBJECT), text, 'utf8');
  try {
    await landRun(walk.coverageFile, coverage, walk.root, walk.cacheRoot, {
      fresh,
      run: { tests: tests.map((file) => ({ file, complete: true })), commit: head },
    });
  } finally {
    await writeFile(resolve(walk.root, SUBJECT), walk.text, 'utf8');
  }
}

/** A run of a test that enters only {@link ELSEWHERE}: the subject's record is carried to HEAD, not recorded. */
export async function runElsewhere(walk: Walk): Promise<void> {
  const { head } = walk;
  const text = 'export const elsewhere = 1;\n';
  const instrumented = instrument(text, ELSEWHERE, ELSEWHERE)!;
  const blocks = coverageBlocks(instrumented.blocks, { text, extentOf: (start, last) => [lineAt(text, start), lineAt(text, last)] });
  const sets = new CrossingSets(1);
  sets.intern([]);
  walk.actions.push({ action: 'run elsewhere', text: walk.texts.length - 1 });
  await landRun(walk.coverageFile, {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit: head,
    tests: [{ file: ELSEWHERE_TEST, complete: true, preconditions: [{ name: ELSEWHERE_TEST, digest: `source:${ELSEWHERE_TEST}` }] }],
    modules: [{
      file: ELSEWHERE,
      sourceDigest: instrumented.sourceDigest,
      instrumented: true,
      blocks: blocks.map((block) => ({ ...block, testFiles: [ELSEWHERE_TEST] })),
    }],
  }, walk.root, walk.cacheRoot, {
    fresh: encodeSetExecutionIndex({
      tests: [{ id: caseOf(ELSEWHERE_TEST), file: ELSEWHERE_TEST, name: 'runs' }],
      modules: [{
        file: ELSEWHERE,
        blocks: blocks.map((block) => ({
          kind: block.kind, name: block.name, path: block.path, startLine: block.startLine!, endLine: block.endLine!, source: block.source,
        })),
        called: Uint32Array.from(blocks, () => sets.intern([0])),
        loaded: Uint8Array.from(blocks, (block) => (block.kind === 'module' ? 1 : 0)),
        // The file is one statement: its top level, which no region owns.
        owner: Uint32Array.from(blocks, () => NO_OWNER),
      }],
      sets: sets.pool(),
    }),
    run: { tests: [{ file: ELSEWHERE_TEST, complete: true }], commit: head },
  });
}

/** The case a test file's run holds. */
export function caseOf(file: string): string {
  return `${file} > runs`;
}

/** What the record holds of the subject, by the label each region stands for. */
export interface Held {
  /** The test files whose cases the case index holds on each labelled region. */
  readonly cases: Readonly<Record<string, readonly string[]>>;
  /** The test files the snapshot's row of each labelled region names. */
  readonly rows: Readonly<Record<string, readonly string[]>>;
  /** The test files the snapshot names as having loaded the module. */
  readonly loadedBy: readonly string[];
}

/** A region by its kind and the lines it stands on. */
export interface Lines {
  readonly kind: string;
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * A namer of the subject's regions at HEAD: the label a region stands for, or
 * its kind and lines where no label stands in it.
 */
export function namer(walk: Walk): (block: Lines) => string {
  const regions = regionsOf(walk.text);
  return (block) => {
    const at = regions.findIndex((region) =>
      region.block.kind === block.kind && region.block.startLine === block.startLine && region.block.endLine === block.endLine);
    return (at < 0 ? undefined : labelOf(regions, at)) ?? `${block.kind}@${block.startLine}-${block.endLine}`;
  };
}

/** The record as a reader opens it from disk, labelled by the subject's text at HEAD. */
export async function held(walk: Walk): Promise<Held> {
  const named = namer(walk);
  // A region no label stands in — the `else` an `if` without one is cut with — is
  // named by its lines, and only when something entered it.
  const put = (into: Record<string, string[]>, block: Lines, tests: readonly string[]): void => {
    const label = named(block);
    if (label.includes('@') && tests.length === 0) return;
    into[label] = [...new Set(tests)].sort();
  };
  const coverage = await readTestCoverage(walk.coverageFile);
  const row = coverage.modules.find((module) => module.file === SUBJECT);
  const rows: Record<string, string[]> = {};
  for (const block of row?.blocks ?? []) put(rows, { kind: block.kind, startLine: block.startLine!, endLine: block.endLine! }, block.testFiles);
  const cases: Record<string, string[]> = {};
  const sections = caseSectionsAt(walk.coverageFile);
  if (sections.index !== undefined) {
    const index = decodeExecutionIndex(sections.index);
    const module = index.modules.find((one) => one.file === SUBJECT);
    for (const block of module?.blocks ?? []) put(cases, block, block.crossings.map((crossing) => index.tests[crossing.test]!.file));
  }
  const loadedBy = [...(row?.blocks.find((block) => block.kind === 'module')?.loadedBy ?? [])].sort();
  return { cases, rows, loadedBy };
}

/**
 * The test files the record owes a run, opened from disk: those it no longer
 * holds whole, because an edit reached a region they entered and they have
 * not run since.
 */
export async function owed(walk: Walk): Promise<readonly string[]> {
  const coverage = await readTestCoverage(walk.coverageFile);
  return coverage.tests.filter((test) => !test.complete).map((test) => test.file).sort();
}

/** The patch from the subject at HEAD to `next`, as `git diff` writes it, leaving HEAD's text in place. */
export async function patchTo(walk: Walk, next: string): Promise<string> {
  await writeFile(resolve(walk.root, SUBJECT), next, 'utf8');
  try {
    return await git(walk.root, 'diff', '--no-color', '--', SUBJECT);
  } finally {
    await writeFile(resolve(walk.root, SUBJECT), walk.text, 'utf8');
  }
}

/** What the selection reads for the change from HEAD to `next`, the record opened from disk: the test files entered. */
export async function selected(walk: Walk, next: string): Promise<readonly string[]> {
  const diff = await patchTo(walk, next);
  const sections = caseSectionsAt(walk.coverageFile);
  const { read } = readJourneyChange(diff, (file) => (file === SUBJECT ? walk.text : undefined), { root: walk.root });
  const narrowing = narrowByJourneys(decodeExecutionIndex(sections.index!), changedLines(diff), { read });
  if (narrowing.unread.length > 0) throw new Error(`the selection read nothing for ${narrowing.unread.join(', ')}`);
  walk.actions.push({ action: 'select', next, entered: narrowing.entered });
  return narrowing.entered.filter((test) => test !== ELSEWHERE_TEST);
}

/**
 * The environment a CLI process of the walk's runs in: the walk's own cache,
 * whatever cache the test runner handed its workers, so the child reads the
 * record and the source index the walk wrote, the same on every machine.
 */
export function cliEnv(walk: Walk): NodeJS.ProcessEnv {
  return { ...process.env, VARIANCE_AUTHORITY_CACHE: walk.cacheRoot };
}

/**
 * {@link selected}, asked of the CLI in a process of its own that opens the
 * record cold, after `variance index` has indexed HEAD into the walk's cache,
 * as a pipeline indexes a commit once before it selects.
 */
export async function selectedByCli(walk: Walk, next: string): Promise<readonly string[]> {
  const diff = await patchTo(walk, next);
  const patch = resolve(walk.scratch, `change-${walk.actions.length}.patch`);
  await writeFile(patch, diff, 'utf8');
  const options = { cwd: walk.root, env: cliEnv(walk), maxBuffer: 64 * 1024 * 1024 };
  if (walk.indexed !== walk.head) {
    await run(process.execPath, [BIN, 'index', '--wait'], options);
    walk.indexed = walk.head;
  }
  const { stdout } = await run(process.execPath, [BIN, 'select', '--execution', walk.coverageFile, '--diff', patch, '--format', 'json'], options);
  walk.actions.push({ action: 'select through the CLI', next, stdout });
  return testsOf(JSON.parse(stdout) as unknown);
}

/** The test files a `--format json` selection names to run. */
function testsOf(output: unknown): readonly string[] {
  const { selected } = output as { readonly selected: readonly { readonly test: string }[] };
  return selected.map(({ test }) => test).filter((test) => test !== ELSEWHERE_TEST).sort();
}

/**
 * `text` with a statement written on the line of `label`'s `hit` call: an edit
 * that rewrites one line strictly inside the region the label names.
 */
export function touching(text: string, label: string): string {
  const call = `hit('${label}');`;
  return text.replace(call, `${call} again();`);
}

/** The exact cases the record names as its last run. */
export async function lastCases(walk: Walk): Promise<readonly string[]> {
  // Defer the reader so the fault-injection harness installs its edit-reading mock before the landing loads.
  const { lastCaseRunOf } = await import('../case-landing.js');
  return lastCaseRunOf(caseSectionsAt(walk.coverageFile))!.cases;
}

/** The same scope read by a fresh CLI process, including its before comparison. */
export async function lastCasesByCli(walk: Walk): Promise<readonly string[]> {
  const { stdout } = await run(process.execPath, [BIN, 'covering', '--file', SUBJECT, '--execution', walk.coverageFile, '--cases', 'last', '--format', 'json'], {
    cwd: walk.root, env: cliEnv(walk), maxBuffer: 64 * 1024 * 1024,
  });
  return (JSON.parse(stdout) as { readonly scope: { readonly tests: readonly string[] } }).scope.tests;
}
