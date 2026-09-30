import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { updateSourceIndex } from '@variance-authority/sense';
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
  async function changed(options: { readonly gone?: boolean; readonly suites?: readonly string[] } = {}): Promise<{ root: string; first: string; against: string }> {
    const root = await mkdtemp(join(tmpdir(), 'variance-review-'));
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'test'));
    git(root, ['init', '--quiet', '--initial-branch', 'main']);
    git(root, ['config', 'user.email', 'fixture@example.test']);
    git(root, ['config', 'user.name', 'Fixture']);
    await writeFile(join(root, 'src/total.ts'), BEFORE);
    await writeFile(join(root, 'test/total.test.ts'), TEST);
    await writeFile(join(root, 'config.json'), '{}\n');
    if (options.suites !== undefined) {
      const suites = Object.fromEntries(options.suites.map((name) => [name, { kind: 'unit' }]));
      await writeFile(join(root, 'variance.config.json'), JSON.stringify({ suites }));
    }
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'first']);
    const first = git(root, ['rev-parse', 'HEAD']);

    await writeFile(join(root, 'src/total.ts'), AFTER);
    await writeFile(join(root, 'test/total.test.ts'), `${TEST}it('rounds', () => {});\n`);
    await writeFile(join(root, 'config.json'), '{ "strict": true }\n');
    process.chdir(root);
    // A test the run recorded and the tree no longer holds, so the import graph has no node for it.
    const extra = options.gone === true ? ['test/round.test.ts'] : [];

    const coverageFile = testCoverageFile(root, { suite: options.suites?.[0] });
    await mkdir(dirname(coverageFile), { recursive: true });
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
    // What the pipeline's `variance index` step publishes after the run; under CI, review refuses to build it itself.
    await updateSourceIndex(root);

    // The base's case index, copied aside before the run the way a pipeline does it.
    const against = join(await mkdtemp(join(tmpdir(), 'variance-review-base-')), 'coverage.bin.cases.bin');
    await writeFile(against, encodeExecutionIndex({
      tests: [DISCOUNTS],
      modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 1, 3, [0])] }],
    }));
    return { root, first, against };
  }

  it('reads the record of the suite it is named, or of the only suite the root declares', async () => {
    const { root, first, against } = await changed({ suites: ['unit'] });
    const regions = (answer: Awaited<ReturnType<typeof review>>) =>
      answer.files.find((file) => file.file === 'src/total.ts')?.regions?.map((region) => region.name);

    expect(regions(await review(parse(['--since', first, '--against', against, '--suite', 'unit', '--root', root])))).toEqual(['applyDiscount', 'round']);
    expect(regions(await review(parse(['--since', first, '--against', against, '--root', root])))).toEqual(['applyDiscount', 'round']);
  });

  it('refuses to pick one of several declared suites for the reader', async () => {
    const { root, first } = await changed({ suites: ['unit', 'browser'] });

    await expect(review(parse(['--since', first, '--root', root]))).rejects.toThrow(/declares the suites "browser", "unit"[^]*--suite <name>/);
  });

  it('reads each edit, counts the changed regions no case covered, and names the cases added', async () => {
    const { root, first, against } = await changed();

    const answer = await review(parse(['--since', first, '--against', against, '--root', root]));

    expect(answer).toMatchObject({ from: first, record: 'ran', base: 'since', suite: 1, before: [{ file: 'config.json', tests: 1 }] });
    const total = answer.files.find((file) => file.file === 'src/total.ts');
    // A new export changes what the module's namespace holds, so the reading is `values`, not `bodies`.
    expect(total?.verdict).toBe('values');
    expect(total?.regions?.map((region) => [region.name, region.reach, region.written, region.called])).toEqual([
      ['applyDiscount', 'near', false, [{ file: 'test/total.test.ts', name: 'discounts' }]],
      ['round', 'unwalked', true, []],
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
    expect(markdown).toContain('### 🧭 What this change did');
    expect(markdown).toContain('> [!WARNING]\n> **1 of 2 changed regions in 1 file have no case that covers them**, all of them new code.');
    expect(markdown).toContain('**What ran each changed function**\n\n<details><summary>🟢 <code>src/total.ts:1-3</code> function <code>applyDiscount</code> — 1 case in 1 test file</summary>\n\n- `test/total.test.ts`\n  - discounts\n\n</details>\n\n🔴 `src/total.ts:5-7` function `round`, new — no case ran it');
    expect(markdown).not.toContain('| **');
    expect(markdown).toContain('⚙️ `config.json` changed, and the one test file loads it before any import.');
    expect(markdown).toContain('<details><summary>🧪 Cases: +1 −0 in 1 test file</summary>');
    expect(markdown).toContain('- `test/total.test.ts`\n  - + rounds');
  });

  it('says what the change might do when the record ran the changed module as other text', async () => {
    const { root, first } = await changed();
    await writeFile(join(root, 'src/total.ts'), `${AFTER}// not run yet\n`);

    const answer = await review(parse(['--since', first, '--root', root]));

    expect(answer.record).toBe('before');
    const markdown = formatReview(answer, 'markdown');
    expect(markdown).toContain('### 🧭 What this change might do');
    expect(markdown).toContain('> [!NOTE]\n> **1 of 2 changed regions in 1 file have no case in the record**, all of them written since it was made, so not run yet.');
    expect(markdown).toContain('**What ran each changed function when the record was made**, so what this change might move');
    expect(markdown).toContain('🔴 `src/total.ts:5-7` function `round`, new — written since the record, so not run yet');
    expect(markdown).not.toContain('🎯');
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
    const select = `\`variance select --since ${first.slice(0, 12)}\``;
    expect(formatReview(answer, 'markdown')).toContain(`🎯 All 1 test file ran at this commit. ${select} lists the ones this change reaches.`);
    expect(formatReview({ ...answer, suite: 4 }, 'markdown')).toContain(
      `🎯 **1 of 4 test files ran** at this commit, 25% of the suite; the other 3 kept the rows recorded before it. ${select}`,
    );
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
