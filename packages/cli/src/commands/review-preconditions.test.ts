import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { updateSourceIndex } from '@variance-authority/sense';
import {
  encodeAsSetExecutionIndex,
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

/** One thing a case said, as the frame spells it: name, value, call site, level. */
type Item = readonly [name: string, value: string | number | boolean, site: string, level: number];

function row(name: string, said?: readonly Item[], id = `${SPEC} > ${name}`): ExecutionTest {
  return { id, file: SPEC, name, stopped: false, ...(said === undefined ? {} : { said: JSON.stringify({ said: said.map(([name, value, site, level]) => [name, JSON.stringify(value), site, level]) }) }) };
}

const SAID: readonly ExecutionTest[] = [
  row('flag off', [['flags:checkout', 'ff-off', `${SPEC}:7`, 1]]),
  row('flag on', [
    ['flags:checkout', 'ff-on', `${SPEC}:3`, 1],
    ['network:api', 'mocked', `${SPEC}:1`, 1],
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
    index: encodeAsSetExecutionIndex({
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

  it('keeps each case\'s preconditions in the JSON, and names the values the cases span on the function\'s row', async () => {
    const { root, first } = await changed(SAID);

    const answer = await review(parse(['--since', first, '--root', root]));

    const region = answer.files.find((file) => file.file === 'src/total.ts')?.regions?.find((one) => one.name === 'applyDiscount');
    expect(region?.called.map((called) => [called.name, called.preconditions])).toEqual([
      ['flag off', [{ name: 'flags:checkout', value: 'ff-off', site: `${SPEC}:7`, level: 1 }]],
      ['flag on', [{ name: 'flags:checkout', value: 'ff-on', site: `${SPEC}:3`, level: 1 }, { name: 'network:api', value: 'mocked', site: `${SPEC}:1`, level: 1 }]],
      ['plain', []],
    ]);
    const markdown = formatReview(answer, 'markdown');
    // `network` is said by one case only, so it does not split the cases and the summary leaves it out.
    expect(markdown).toMatch(/\| 🟢 \| `applyDiscount` \|[^\n]*\| 3; ran under flags:checkout=ff-off, flags:checkout=ff-on \|/u);
    expect(markdown).not.toContain('unmeasured');
  });

  it('orders the names the cases span, and each name\'s values, by code unit', async () => {
    // Said out of order: `zone` before `Locale`, `east` before `West`, `fr` before `de`.
    const { root, first } = await changed([
      row('first', [
        ['geo:zone', 'east', `${SPEC}:1`, 1],
        ['Locale', 'fr', `${SPEC}:2`, 1],
      ]),
      row('second', [
        ['geo:zone', 'West', `${SPEC}:5`, 1],
        ['Locale', 'de', `${SPEC}:6`, 1],
      ]),
    ]);

    const markdown = formatReview(await review(parse(['--since', first, '--root', root])), 'markdown');

    expect(markdown).toContain('| 2; ran under Locale=de, Locale=fr, geo:zone=West, geo:zone=east |');
  });

  it('keeps a flag set and a flag said as the text `true` apart, as `covering` prints them', async () => {
    const { root, first } = await changed([
      row('set', [['flags:checkout', true, `${SPEC}:1`, 1]]),
      row('said', [['flags:checkout', 'true', `${SPEC}:5`, 1]]),
    ]);

    const markdown = formatReview(await review(parse(['--since', first, '--root', root])), 'markdown');

    expect(markdown).toContain('| 2; ran under flags:checkout, flags:checkout=true |');
  });

  it('splits two record values of one key apart, by their JSON', async () => {
    const { root, first } = await changed([
      row('one', [['fixture:cart', { items: 1 }, `${SPEC}:1`, 1]]),
      row('two', [['fixture:cart', { items: 2 }, `${SPEC}:5`, 1]]),
    ]);

    const markdown = formatReview(await review(parse(['--since', first, '--root', root])), 'markdown');

    expect(markdown).toContain('| 2; ran under fixture:cart={"items":1}, fixture:cart={"items":2} |');
  });

  it('prints a value as its text, never as markup the comment would render', async () => {
    const { root, first } = await changed([
      row('bold', [['copy:label', '<b>x</b>', `${SPEC}:1`, 1]]),
      row('closing', [['copy:label', '</summary>', `${SPEC}:5`, 1]]),
    ]);

    const markdown = formatReview(await review(parse(['--since', first, '--root', root])), 'markdown');

    expect(markdown).toContain('ran under copy:label=&lt;/summary&gt;, copy:label=&lt;b&gt;x&lt;/b&gt; |');
    expect(markdown).not.toContain('<b>x</b>');
    expect(markdown.split('</summary>').length).toBe(markdown.split('<summary>').length);
  });

  it('tells two cases of one title apart by the id their producer gave them', async () => {
    const { root, first } = await changed([row('twin', []), row('twin', undefined, `${SPEC} > twin [2]`)]);

    const markdown = formatReview(await review(parse(['--since', first, '--root', root])), 'markdown');

    expect(markdown).toContain('1 changed function — 2 cases in 1 test file</summary>');
    expect(markdown).toContain('1 of 2 cases was recorded without preconditions, so the state it ran under is unmeasured.');
  });

  it('says what the cases arranged is unmeasured, never none, from a record made before cases said anything', async () => {
    const { root, first } = await changed(SAID.map(({ said: _, ...test }) => test));

    const answer = await review(parse(['--since', first, '--root', root]));

    const region = answer.files.find((file) => file.file === 'src/total.ts')?.regions?.find((one) => one.name === 'applyDiscount');
    expect(region?.called.every((called) => !('preconditions' in called))).toBe(true);
    const markdown = formatReview(answer, 'markdown');
    expect(markdown).toContain("The record holds no case's preconditions, so the state these cases ran under is unmeasured.");
    expect(markdown).toMatch(/\| 🟢 \| `applyDiscount` \|[^\n]*\| 3 \|/u);
  });

  it('counts the cases nobody listened to when the others said what they arranged', async () => {
    const { root, first } = await changed([...SAID, row('unheard')]);

    const markdown = formatReview(await review(parse(['--since', first, '--root', root])), 'markdown');

    expect(markdown).toContain('1 of 4 cases was recorded without preconditions, so the state it ran under is unmeasured.');
  });

  it('gives a case that misused a breadcrumb its misuse apart from what the code read, and splits nothing by it', async () => {
    const reading: ExecutionTest = {
      id: `${SPEC} > reads`, file: SPEC, name: 'reads', stopped: false,
      said: JSON.stringify({
        said: [],
        read: [['flags:checkout', '"on"', 'src/total.ts:2', 0xffff]],
        misused: [['key', '7', 'src/total.ts:2', 0xffff]],
      }),
    };
    const { root, first } = await changed([reading]);

    const answer = await review(parse(['--since', first, '--root', root]));

    const region = answer.files.find((file) => file.file === 'src/total.ts')?.regions?.find((one) => one.name === 'applyDiscount');
    expect(region?.called.map(({ reads, misused }) => ({ reads, misused }))).toEqual([{
      reads: [{ name: 'flags:checkout', value: 'on', site: 'src/total.ts:2', level: 0xffff }],
      misused: [{ argument: 'key', value: 7, site: 'src/total.ts:2', level: 0xffff }],
    }]);
    const markdown = formatReview(answer, 'markdown');
    expect(markdown).not.toMatch(/(^|[ ;|])read the key/mu);
    expect(markdown).toContain('misused varianceBreadcrumb at src/total.ts:2 by 1: the key 7 is not a string');
  });
});
