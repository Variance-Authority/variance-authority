import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import {
  commitRunsFile,
  encodeExecutionIndex,
  testCoverageFile,
  writeTestCoverage,
  type ExecutionBlock,
  type ExecutionIndex,
} from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import { readFlags } from '../args.js';
import { parseReviewArgs } from '../review-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { review } from './review.js';
import { formatReview, REVIEW_MARKER } from './review-text.js';

const BEFORE = 'export function applyDiscount(price: number): number {\n  return price * 0.9;\n}\n';
const AFTER = `${BEFORE.replace('0.9', '0.8')}\nexport function round(price: number): number {\n  return Math.round(price);\n}\n`;
const TEST = "import { applyDiscount } from '../src/total';\nit('discounts', () => applyDiscount(1));\n";

const DISCOUNTS = { id: 'test/total.test.ts > discounts', file: 'test/total.test.ts', name: 'discounts', stopped: false };
const ROUNDS = { id: 'test/total.test.ts > rounds', file: 'test/total.test.ts', name: 'rounds', stopped: false };
const GONE = { id: 'test/round.test.ts > rounds up', file: 'test/round.test.ts', name: 'rounds up', stopped: false };

function block(name: string, startLine: number, endLine: number, tests: readonly number[]): ExecutionBlock {
  return { kind: 'function', name, path: name, startLine, endLine, source: true, crossings: tests.map((test) => ({ test, distance: 0 })) };
}

const git = (at: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: at, stdio: 'pipe', encoding: 'utf8' }).trim();

function parse(argv: readonly string[]) {
  return parseReviewArgs(readFlags(argv, 'review', flagsFor('review'), synopsisFor('review')));
}

describe('a review of what a change did, after the run that recorded it', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  /** `main` at the base, the change in the working tree, and the run after it recorded. */
  async function changed(options: { readonly gone?: boolean } = {}): Promise<{ root: string; first: string; against: string }> {
    const root = await mkdtemp(join(tmpdir(), 'variance-review-'));
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'test'));
    git(root, ['init', '--quiet', '--initial-branch', 'main']);
    git(root, ['config', 'user.email', 'fixture@example.test']);
    git(root, ['config', 'user.name', 'Fixture']);
    await writeFile(join(root, 'src/total.ts'), BEFORE);
    await writeFile(join(root, 'test/total.test.ts'), TEST);
    await writeFile(join(root, 'config.json'), '{}\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'first']);
    const first = git(root, ['rev-parse', 'HEAD']);

    await writeFile(join(root, 'src/total.ts'), AFTER);
    await writeFile(join(root, 'test/total.test.ts'), `${TEST}it('rounds', () => {});\n`);
    await writeFile(join(root, 'config.json'), '{ "strict": true }\n');
    process.chdir(root);
    // A test the run recorded and the tree no longer holds, so the import graph has no node for it.
    const extra = options.gone === true ? ['test/round.test.ts'] : [];

    const coverageFile = testCoverageFile(root);
    await writeTestCoverage(coverageFile, {
      version: 3,
      instrumentation: 'fixture',
      commit: first,
      tests: [
        { file: 'test/total.test.ts', complete: true, preconditions: [{ name: 'config.json', digest: digestString('{}') }] },
        ...extra.map((file) => ({ file, complete: true, preconditions: [] })),
      ],
      modules: [{
        file: 'src/total.ts',
        sourceDigest: digestString(AFTER),
        instrumented: true,
        blocks: [
          { ordinal: 0, kind: 'function', digest: digestString('applyDiscount'), name: 'applyDiscount', path: 'applyDiscount', startLine: 1, endLine: 3, source: true, testFiles: ['test/total.test.ts'] },
          { ordinal: 1, kind: 'function', digest: digestString('round'), name: 'round', path: 'round', startLine: 5, endLine: 7, source: true, testFiles: extra },
        ],
      }],
    });
    const now: ExecutionIndex = {
      tests: [DISCOUNTS, ROUNDS, ...(extra.length === 0 ? [] : [GONE])],
      modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 1, 3, [0]), block('round', 5, 7, extra.length === 0 ? [] : [2])] }],
    };
    await writeFile(`${coverageFile}.cases.bin`, encodeExecutionIndex(now));

    // The base's case index, copied aside before the run the way a pipeline does it.
    const against = join(await mkdtemp(join(tmpdir(), 'variance-review-base-')), 'coverage.bin.cases.bin');
    await writeFile(against, encodeExecutionIndex({
      tests: [DISCOUNTS],
      modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 1, 3, [0])] }],
    }));
    return { root, first, against };
  }

  it('reads each edit, counts the changed regions no case covered, and names the cases added', async () => {
    const { root, first, against } = await changed();

    const answer = await review(parse(['--since', first, '--against', against, '--root', root]));

    expect(answer).toMatchObject({ from: first, base: 'since', suite: 1, before: [{ file: 'config.json', tests: 1 }] });
    const total = answer.files.find((file) => file.file === 'src/total.ts');
    // A new export changes what the module's namespace holds, so the reading is `values`, not `bodies`.
    expect(total?.verdict).toBe('values');
    expect(total?.regions?.map((region) => [region.name, region.reach, region.written])).toEqual([
      ['applyDiscount', 'near', false],
      ['round', 'unwalked', true],
    ]);
    expect(answer.files.find((file) => file.file === 'test/total.test.ts')?.cases).toEqual({ added: ['rounds'], removed: [] });

    const text = formatReview(answer, 'text');
    expect(text).toContain('2 changed regions in 1 file, 1 of them new.');
    expect(text).toContain('- 1 no case covered, 1 of them new.');
    expect(text).toContain('Cases: 1 added, 0 removed, in 1 test file.');
    expect(text).toContain('- config.json: 1 of 1 test files');
    expect(text).toContain('  src/total.ts:5-7 function round — no case covered it (new)');

    const markdown = formatReview(answer, 'markdown');
    expect(markdown.startsWith(`${REVIEW_MARKER}\n`)).toBe(true);
    expect(markdown).toContain('| no case covered it | 1 | 1 |');
  });

  it('does not call a region far when the only test that covered it is one the import graph does not hold', async () => {
    const { root, first } = await changed({ gone: true });

    const answer = await review(parse(['--since', first, '--root', root]));

    const total = answer.files.find((file) => file.file === 'src/total.ts');
    expect(total?.regions?.find((region) => region.name === 'round')?.reach).toBe('unplaced');
    expect(formatReview(answer, 'text')).toContain('- 1 covered by tests the import graph does not hold, so how far is not known.');
  });

  it('starts where the recording stood before the runs at this commit, when no base is named', async () => {
    const { root, first } = await changed();
    await writeFile(commitRunsFile(testCoverageFile(root)), JSON.stringify({
      over: first, first: '2026-09-26T00:00:00.000Z', latest: '2026-09-26T00:00:00.000Z', runs: 2, files: ['test/total.test.ts'],
    }));

    const answer = await review(parse(['--root', root]));

    expect(answer).toMatchObject({ from: first, base: 'recording', runs: { runs: 2 } });
    expect(formatReview(answer, 'text')).toContain('the commit the recording was at before these runs. 2 runs recorded 1 test file.');
  });

  it('writes the answer beside what it prints when given a directory', async () => {
    const { root, first, against } = await changed();
    const out = join(await mkdtemp(join(tmpdir(), 'variance-review-out-')), 'review');
    let printed = '';

    const code = await main(['review', '--since', first, '--against', against, '--root', root, '--out', out], {
      out: (text) => (printed += text),
      err: () => {},
    });

    expect(code).toBe(0);
    expect(printed).toContain('2 changed regions in 1 file');
    expect(JSON.parse(await readFile(join(out, 'review.json'), 'utf8')).from).toBe(first);
    expect(await readFile(join(out, 'review.md'), 'utf8')).toContain(REVIEW_MARKER);
  });

  it('is refused as unrecorded when no run listed itself and no base is named', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-review-bare-'));

    await expect(review(parse(['--root', root]))).rejects.toThrow(/no run has listed itself/);
  });

  it('refuses a format it does not write', () => {
    expect(() => parse(['--format', 'html'])).toThrow(/--format must be text, markdown or json/);
  });
});
