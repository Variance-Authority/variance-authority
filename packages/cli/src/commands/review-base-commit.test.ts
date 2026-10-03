import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeExecutionIndex, writeTestCoverage, type ExecutionIndex } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import { DISCOUNTS, cloneOf, git, published, ranHere } from './mainline-fixture.js';

/**
 * A review compares the cases with a base only through the diff from the
 * commit the base was recorded at. Where that diff cannot be read, the review
 * fails, as a CI step, and says what to fetch.
 */

let home: string;
const cwd = process.cwd();
const ABSENT = 'f'.repeat(40);

const CASES: ExecutionIndex = {
  tests: [DISCOUNTS],
  modules: [{
    file: 'src/total.ts',
    blocks: [{ kind: 'function', name: 'applyDiscount', path: 'applyDiscount', startLine: 1, endLine: 3, source: true, crossings: [{ test: 0, distance: 0 }] }],
  }],
};

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'variance-review-base-commit-'));
  process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'ci-cache');
});

afterEach(async () => {
  process.chdir(cwd);
  delete process.env['VARIANCE_AUTHORITY_CACHE'];
  await rm(home, { recursive: true, force: true });
});

async function ask(argv: readonly string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

/** A record of the cases alone, whose last run names `commit`, or none. */
async function casesAt(commit: string | undefined): Promise<string> {
  const at = join(home, `against-${commit ?? 'none'}.bin`);
  const last = { ...(commit === undefined ? {} : { commit }), at: '2026-09-26T00:00:00.000Z', files: [DISCOUNTS.file], cases: [] };
  await writeTestCoverage(
    at,
    { version: 3, instrumentation: 'fixture', tests: [], modules: [] },
    { index: encodeExecutionIndex(CASES), last: Buffer.from(JSON.stringify(last)) },
  );
  return at;
}

describe('`variance review --against` a base whose commit it cannot diff from', () => {
  it('fails when the base was recorded at a commit this clone does not have, and names how to fetch it', async () => {
    const ci = await published(home);
    const clone = await cloneOf(home, ci.origin);
    process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'laptop-cache');
    await ranHere(clone, ci.first);

    const answer = await ask(['review', '--root', clone, '--since', 'origin/main', '--against', await casesAt(ABSENT)]);

    expect(answer.code).toBe(2);
    expect(answer.out).toBe('');
    expect(answer.err).toContain(`was recorded at ${ABSENT}, which this clone does not have`);
    expect(answer.err).toContain(`git fetch origin ${ABSENT}`);
    expect(answer.err).toContain('fetch-depth: 0');
  });

  it('fails when the base names no commit', async () => {
    const ci = await published(home);
    const clone = await cloneOf(home, ci.origin);
    process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'laptop-cache');
    await ranHere(clone, ci.first);

    const answer = await ask(['review', '--root', clone, '--since', 'origin/main', '--against', await casesAt(undefined)]);

    expect(answer.code).toBe(2);
    expect(answer.out).toBe('');
    expect(answer.err).toContain('names no commit it was recorded at');
  });
});

describe('`variance review --coverage` in a clone without the commit its mainline published at', () => {
  it('fails, and names how to fetch it, rather than leaving the coverage out of the review', async () => {
    const ci = await published(home);
    await git(ci.dir, 'commit', '--quiet', '--allow-empty', '-m', 'second');
    await git(ci.dir, 'push', '--quiet', 'origin', 'main');
    const second = await git(ci.dir, 'rev-parse', 'HEAD');
    // A checkout with only the tip, as `actions/checkout` makes one by default.
    const clone = join(home, 'clone');
    await git(home, 'clone', '--quiet', '--depth', '1', pathToFileURL(ci.origin).href, clone);
    process.env['VARIANCE_AUTHORITY_CACHE'] = join(home, 'laptop-cache');
    await ranHere(clone, second);

    // Diffed from the tip, which the clone has: only the coverage's base is the mainline's.
    const answer = await ask(['review', '--root', clone, '--since', 'HEAD', '--coverage']);

    expect(answer.code).toBe(2);
    expect(answer.out).toBe('');
    expect(answer.err).toContain(`was recorded at ${ci.first}, which this clone does not have`);
    expect(answer.err).toContain(`git fetch origin ${ci.first}`);
  });
});
