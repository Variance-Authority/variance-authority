import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeAsSetExecutionIndex, testCoverageFile, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { main } from '../bin.fixture.js';

/**
 * The comment `Variance-Authority/action/review` posts, given `test`, compares
 * with the mainline's record (#1091): the cache restore lays that record where
 * the suite's own goes, `carry take` sets it aside before the tests write over
 * it, and `review --against` reads what the take named. Each step is the CLI
 * command the action runs, in its order, and the comment is the `review.md`
 * the action posts.
 */

type Index = Parameters<typeof encodeAsSetExecutionIndex>[0];

const UNIT = { id: 'u', file: 'src/pay.test.ts', name: 'charges once', stopped: false };

const TEXT = ['export function pick() {', '  return 0;', '}', '', 'export function refund() {', '  return 1;', '}', ''].join('\n');

const region = (name: string, startLine: number, endLine: number, called: boolean) => ({
  kind: 'function', name, path: 'entry', startLine, endLine, source: true,
  crossings: called ? [{ test: 0, distance: 0 }] : [],
});

/** The mainline's run: the case ran both functions. */
const MAINLINE: Index = { tests: [UNIT], modules: [{ file: 'src/pay.ts', blocks: [region('pick', 1, 3, true), region('refund', 5, 7, true)] }] };

/** The pull request's run: the case no longer reaches `refund`. */
const PULL_REQUEST: Index = { tests: [UNIT], modules: [{ file: 'src/pay.ts', blocks: [region('pick', 1, 3, true), region('refund', 5, 7, false)] }] };

let cache: string;
let previous: string | undefined;
let repo: string;
let commit: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, encoding: 'utf8' }).trim();

async function record(index: Index): Promise<void> {
  const at = testCoverageFile(repo, { suite: 'unit' });
  await mkdir(dirname(at), { recursive: true });
  const cases = { index: encodeAsSetExecutionIndex(index), last: Buffer.from(JSON.stringify({ commit, files: [] })) };
  await writeTestCoverage(at, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, cases);
}

/** What `main` prints for `argv`, run from the checkout as a workflow step runs there. */
async function step(argv: readonly string[]) {
  let out = '';
  let err = '';
  const cwd = process.cwd();
  process.chdir(repo);
  try {
    const code = await main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
    return { code, out, err };
  } finally {
    process.chdir(cwd);
  }
}

/** The comment the review step writes, as `--out <dir> --format markdown` leaves it for the post. */
async function comment(against: readonly string[]): Promise<string> {
  const out = await mkdtemp(join(tmpdir(), 'variance-review-against-take-out-'));
  try {
    const reviewed = await step(['review', '--since', 'HEAD', '--suite', 'unit', '--coverage', ...against, '--out', out, '--format', 'markdown']);
    expect(reviewed.code, reviewed.err).toBe(0);
    return await readFile(join(out, 'review.md'), 'utf8');
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

let against: string;

beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-review-against-take-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  repo = await realpath(await mkdtemp(join(tmpdir(), 'variance-review-against-take-')));
  execFileSync('git', ['init', '--quiet', repo]);
  await writeFile(join(repo, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit', carry: 'actions-cache' } } }));
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, 'src/pay.ts'), TEXT);
  git('add', '.');
  git('commit', '--quiet', '-m', 'base');
  commit = git('rev-parse', 'HEAD');
  // The cache restore lays the mainline's record where the suite's own goes.
  await record(MAINLINE);
  const taken = await step(['carry', 'take', '--format', 'github']);
  expect(taken.code, taken.err).toBe(0);
  against = /^against-unit=(.+)$/mu.exec(taken.out)?.[1] ?? '';
  // The tests run and write over it.
  await record(PULL_REQUEST);
  const indexed = await step(['index']);
  expect(indexed.code, indexed.err).toBe(0);
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(cache, { recursive: true, force: true });
  await rm(repo, { recursive: true, force: true });
});

describe("the comment a review with `test` posts compares with the mainline's record", () => {
  it("names the region the mainline ran and the pull request's tests no longer run", async () => {
    expect(against).not.toBe('');

    const posted = await comment(['--against', against]);

    expect(posted).toContain('| `unit` | 50.0% | 100.0% previously; 1 region no longer run |');
    expect(posted).toContain(`Against ${against} at ${commit.slice(0, 12)}: 1 lost.`);
    expect(posted).not.toContain('No baseline available');
  });

  it('reads as compared with nothing when the review is not handed what the take set aside', async () => {
    expect(await comment([])).toContain('No baseline available; change cannot be compared');
  });
});
