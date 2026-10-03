import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { updateSourceIndex } from '@variance-authority/sense';
import {
  encodeExecutionIndex,
  testCoverageFile,
  withCaseSections,
  writeTestCoverage,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseReviewArgs } from '../review-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { review } from './review.js';
import { formatReview } from './review-text.js';

const BEFORE = 'export function applyDiscount(price: number): number {\n  return price * 0.9;\n}\n';
const AFTER = BEFORE.replace('0.9', '0.8');
const SPEC = 'test/total.test.ts';
const TEST = "import { applyDiscount } from '../src/total';\nit('discounts', () => applyDiscount(1));\n";

function row(name: string, preconditions?: ExecutionTest['preconditions']): ExecutionTest {
  return { id: `${SPEC} > ${name}`, file: SPEC, name, stopped: false, ...(preconditions === undefined ? {} : { preconditions }) };
}

const SAID: readonly ExecutionTest[] = [
  row('flag off', [{ name: 'flag', value: 'ff-off', site: `${SPEC}:7`, level: 1 }]),
  row('flag on', [
    { name: 'flag', value: 'ff-on', site: `${SPEC}:3`, level: 1 },
    { name: 'network', value: 'mocked', site: `${SPEC}:1`, level: 1 },
  ]),
  row('plain', []),
];

const git = (at: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: at, stdio: 'pipe', encoding: 'utf8' }).trim();

function parse(argv: readonly string[]) {
  return parseReviewArgs(readFlags(argv, 'review', flagsFor('review'), synopsisFor('review')));
}

/** `main` at the base, a changed body in the working tree, and a record of these cases running it. */
async function changed(tests: readonly ExecutionTest[]): Promise<{ root: string; first: string }> {
  const root = await mkdtemp(join(tmpdir(), 'variance-review-said-'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'test'));
  git(root, ['init', '--quiet', '--initial-branch', 'main']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  await writeFile(join(root, 'src/total.ts'), BEFORE);
  await writeFile(join(root, SPEC), TEST);
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'first']);
  const first = git(root, ['rev-parse', 'HEAD']);
  await writeFile(join(root, 'src/total.ts'), AFTER);
  process.chdir(root);

  const coverageFile = testCoverageFile(root);
  await mkdir(dirname(coverageFile), { recursive: true });
  await writeTestCoverage(coverageFile, {
    version: 3,
    instrumentation: 'fixture',
    commit: first,
    tests: [{ file: SPEC, complete: true, preconditions: [] }],
    modules: [{
      file: 'src/total.ts',
      sourceDigest: digestString(AFTER),
      instrumented: true,
      blocks: [{ ordinal: 0, kind: 'function', digest: digestString('applyDiscount'), name: 'applyDiscount', path: 'applyDiscount', startLine: 1, endLine: 3, source: true, testFiles: [SPEC] }],
    }],
  });
  await writeFile(coverageFile, withCaseSections(await readFile(coverageFile), {
    index: encodeExecutionIndex({
      tests,
      modules: [{
        file: 'src/total.ts',
        blocks: [{
          kind: 'function', name: 'applyDiscount', path: 'applyDiscount', startLine: 1, endLine: 3, source: true,
          crossings: tests.map((_, test) => ({ test, distance: 0 })),
        }],
      }],
    }),
  }));
  await updateSourceIndex(root);
  return { root, first };
}

describe('the cases a review lists under a changed function, with what each arranged', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it('prints each case\'s preconditions the way `covering` does, and a name the cases span on the function\'s line', async () => {
    const { root, first } = await changed(SAID);

    const answer = await review(parse(['--since', first, '--root', root]));

    const region = answer.files.find((file) => file.file === 'src/total.ts')?.regions?.find((one) => one.name === 'applyDiscount');
    expect(region?.called.map((called) => [called.name, called.preconditions])).toEqual([
      ['flag off', [{ name: 'flag', value: 'ff-off', site: `${SPEC}:7`, level: 1 }]],
      ['flag on', [{ name: 'flag', value: 'ff-on', site: `${SPEC}:3`, level: 1 }, { name: 'network', value: 'mocked', site: `${SPEC}:1`, level: 1 }]],
      ['plain', []],
    ]);
    const markdown = formatReview(answer, 'markdown');
    // `network` is said by one case only, so it does not split the cases and the summary leaves it out.
    expect(markdown).toContain('<details><summary>🟢 <code>applyDiscount</code> — 3 cases in 1 test file; ran under flag=ff-off, flag=ff-on</summary>');
    expect(markdown).toContain([
      `- \`${SPEC}\``,
      `  - flag off — flag=ff-off (${SPEC}:7)`,
      `  - flag on — flag=ff-on (${SPEC}:3), network=mocked (${SPEC}:1)`,
      '  - plain',
    ].join('\n'));
    expect(markdown).not.toContain('unmeasured');
  });

  it('says what the cases arranged is unmeasured, never none, from a record made before cases said anything', async () => {
    const { root, first } = await changed(SAID.map(({ preconditions: _, ...test }) => test));

    const answer = await review(parse(['--since', first, '--root', root]));

    const region = answer.files.find((file) => file.file === 'src/total.ts')?.regions?.find((one) => one.name === 'applyDiscount');
    expect(region?.called.every((called) => !('preconditions' in called))).toBe(true);
    const markdown = formatReview(answer, 'markdown');
    expect(markdown).toContain("The record holds no case's preconditions, so what these cases arranged is unmeasured.");
    expect(markdown).toContain('<details><summary>🟢 <code>applyDiscount</code> — 3 cases in 1 test file</summary>');
  });

  it('counts the cases nobody listened to when the others said what they arranged', async () => {
    const { root, first } = await changed([...SAID, row('unheard')]);

    const markdown = formatReview(await review(parse(['--since', first, '--root', root])), 'markdown');

    expect(markdown).toContain('1 of 4 cases was not listened to, so what it arranged is unmeasured.');
  });
});
