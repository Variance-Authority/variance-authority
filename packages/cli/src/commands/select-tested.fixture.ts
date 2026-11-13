import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { indexOutput } from './index-command.js';
import { PUSH, cloneOf, git, originAndCi, publishTo, shareConfig } from './mainline-fixture.js';
import { selectOutput } from './select-command.js';

/**
 * A merge queue's checkout for `variance select --ran-at`: a pull request
 * tested at its own tree meets the mainline that moved past it.
 *
 * Two folders, one test each: `total` and `other`. The fork `R` is the
 * mainline when the pull request branched; `P` is the mainline the queue
 * merges onto; `T` is the pull request's tested tree.
 */

export const TOTAL = 'export function total(price: number): number {\n  return price * 0.9;\n}\n';
export const OTHER = 'export function other(price: number): number {\n  return price + 1;\n}\n';
export const PADDED = "import pad from 'left-pad';\nexport function total(price: number): number {\n  return pad(price) * 0.9;\n}\n";
const TOTAL_TEST = "import { total } from '../src/total';\nit('totals', () => total(1));\n";
const OTHER_TEST = "import { other } from '../src/other';\nit('others', () => other(1));\n";
export const DEV = ['-c', 'user.name=Dev', '-c', 'user.email=dev@example.test'];

/** Files by path; `null` deletes the file. */
export type Files = Readonly<Record<string, string | null>>;

export interface Queue {
  /** Files at the fork, beside the two folders and their tests. */
  readonly start?: Files;
  /** Which test entered each file the record holds beyond each folder's own module. */
  readonly entered?: Readonly<Record<string, string>>;
  /** What the mainline lands past the fork, which the queue merges onto. */
  readonly base: Files;
  /** What the mainline lands past the fork and then reverts, before `base`: a pull request's check may have run with it. */
  readonly reverted?: Files;
  /** What each pull request changes from the fork; the last is the one tested. */
  readonly prs: readonly Files[];
  /** Where the mainline published its record: at the fork, or at the base. */
  readonly recordAt: 'fork' | 'base';
  /** What the tested pull request pushes past its tested commit, before the queue merges it. */
  readonly past?: Files;
  /** The queue commits the group as one commit on the base, as a squash queue does, rather than merging it. */
  readonly squash?: boolean;
}

export interface Queued {
  readonly dir: string;
  readonly base: string;
  readonly tested: string;
  readonly fork: string;
}

/** The scratch directory of the running test, made before and removed after each. */
export function scratch(): () => string {
  let home = '';
  const cwd = process.cwd();
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'variance-select-tested-'));
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'ci-cache'));
  });
  afterEach(async () => {
    process.chdir(cwd);
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });
  return () => home;
}

/**
 * A merge-queue checkout: the mainline's record published, the pull requests
 * branched from the fork, and `HEAD` the queue's commit — the base with each
 * pull request merged onto it in turn. `tested` is the last pull request's tree.
 */
export async function queued(home: string, queue: Queue): Promise<Queued> {
  const { origin, ci } = await originAndCi(home);
  await written(ci, {
    'src/total.ts': TOTAL, 'src/other.ts': OTHER, 'test/total.test.ts': TOTAL_TEST, 'test/other.test.ts': OTHER_TEST,
    'variance.config.json': JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'share' } }, share: shareConfig(home).share }),
    ...queue.start,
  });
  await git(ci, 'add', '-A');
  await git(ci, 'commit', '--quiet', '-m', 'fork');
  const fork = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'remote', 'add', 'origin', origin);
  await git(ci, 'push', '--quiet', 'origin', 'main');

  const tips: string[] = [];
  for (const [index, pr] of queue.prs.entries()) {
    await git(ci, 'checkout', '--quiet', '-b', `pr-${index}`, fork);
    await written(ci, pr);
    await git(ci, 'add', '-A');
    await git(ci, ...DEV, 'commit', '--quiet', '-m', `pr ${index}`);
    tips.push(await git(ci, 'rev-parse', 'HEAD'));
    if (queue.past !== undefined && index === queue.prs.length - 1) {
      await written(ci, queue.past);
      await git(ci, 'add', '-A');
      await git(ci, ...DEV, 'commit', '--quiet', '-m', `pr ${index} past its test`);
    }
    await git(ci, 'push', '--quiet', 'origin', `pr-${index}`);
  }
  await git(ci, 'checkout', '--quiet', 'main');

  if (queue.recordAt === 'fork') await recorded(home, ci, queue.entered ?? {});
  if (queue.reverted !== undefined) {
    await written(ci, queue.reverted);
    await git(ci, 'add', '-A');
    await git(ci, 'commit', '--quiet', '-m', 'lands');
    await git(ci, 'revert', '--no-edit', 'HEAD');
  }
  await written(ci, queue.base);
  await git(ci, 'add', '-A');
  await git(ci, 'commit', '--quiet', '-m', 'base');
  const base = await git(ci, 'rev-parse', 'HEAD');
  await git(ci, 'push', '--quiet', 'origin', 'main');
  if (queue.recordAt === 'base') await recorded(home, ci, queue.entered ?? {});

  const dir = await cloneOf(home, origin);
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', join(home, 'queue-cache'));
  await git(dir, 'fetch', '--quiet', 'origin', ...queue.prs.map((_, index) => `pr-${index}`));
  await git(dir, 'checkout', '--quiet', '-b', 'gh-readonly-queue/main/pr-1', base);
  for (const index of tips.keys()) {
    if (queue.squash !== true) {
      await git(dir, ...DEV, 'merge', '--quiet', '--no-ff', '--no-edit', `origin/pr-${index}`);
      continue;
    }
    await git(dir, ...DEV, 'merge', '--quiet', '--squash', `origin/pr-${index}`);
    await git(dir, ...DEV, 'commit', '--quiet', '-m', `pr ${index}, squashed`);
  }
  return { dir, base, tested: tips.at(-1)!, fork };
}

export async function written(dir: string, files: Files): Promise<void> {
  for (const [file, source] of Object.entries(files)) {
    if (source === null) {
      await rm(join(dir, file));
      continue;
    }
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), source);
  }
}

/**
 * The record a whole run at `HEAD` of `ci` made, published to the mainline:
 * each test entered its own folder's module, and each file of `entered` as it
 * names, with the text each file holds there.
 */
async function recorded(home: string, ci: string, entered: Readonly<Record<string, string>>): Promise<void> {
  const commit = await git(ci, 'rev-parse', 'HEAD');
  const held = { 'src/other.ts': 'test/other.test.ts', 'src/total.ts': 'test/total.test.ts', ...entered };
  const modules = [];
  for (const [file, test] of Object.entries(held).sort(([a], [b]) => codeUnitOrder(a, b))) {
    modules.push(moduleOf(file, await readFile(join(ci, file), 'utf8'), test));
  }
  await writeTestCoverage(testCoverageFile(ci, { suite: 'unit' }), {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: [
      { file: 'test/other.test.ts', complete: true, preconditions: [], duration: 60_000 },
      { file: 'test/total.test.ts', complete: true, preconditions: [], duration: 60_000 },
    ],
    modules,
  });
  await publishTo(home, ci, commit, PUSH, 'mainline main');
}

/** `file` holding `source`: its module, and one function over every line, both entered by `test` alone. */
function moduleOf(file: string, source: string, test: string) {
  const lines = source.split('\n').length - 1;
  return {
    file,
    sourceDigest: digestString(source),
    instrumented: true,
    blocks: [{
      ordinal: 0, kind: 'module' as const, digest: digestString(file), name: '', path: 'module',
      startLine: 1, endLine: lines, source: true, testFiles: [test],
    }, {
      ordinal: 1, owner: 0, kind: 'function' as const, digest: digestString(`${file}#body`), name: 'body', path: 'body',
      startLine: 1, endLine: lines, source: true, testFiles: [test],
    }],
  };
}

/** Select in the queue's checkout, as its workflow does: from the base it merges onto, with `tested` when given. */
export async function selected(dir: string, since: string, tested?: string): Promise<{ out: string; err: string }> {
  process.chdir(dir);
  await indexOutput({ cwd: dir });
  return selectOutput({ cwd: dir, format: 'plain', since, ...(tested === undefined ? {} : { ranAt: tested }) });
}
