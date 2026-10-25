import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseReviewArgs } from '../review-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { review, type Review } from './review.js';
import { formatReview } from './review-text.js';

// A change that puts new code behind new flags, run by Vitest through the real
// seam on the change, then reviewed. Each flag has a case with it on and one
// with it off. `shipping` changed a line outside its flag, which the flag-off
// case reaches; `express` is new and only the flag-on case reaches it; `fee`,
// `tax` and `tip` move the old code into the flag-off arm by an `else`, a
// ternary and an early return, so a flag-off case reaching them is the old
// code running. The review prints what each region's cases read and leaves the
// judging to whoever holds the diff.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');

const BEFORE = `export interface Flags { readonly [key: string]: boolean | undefined }

export function shipping(weight: number, flags: Flags): number {
  return weight * 2;
}

export function fee(amount: number, flags: Flags): number {
  return amount + 1;
}

export function tax(amount: number, flags: Flags): number {
  return amount * 2;
}

export function tip(amount: number, flags: Flags): number {
  return amount * 3;
}
`;

const AFTER = `import { varianceBreadcrumb } from '@variance-authority/event';

export interface Flags { readonly [key: string]: boolean | undefined }

const on = (flags: Flags, key: string): boolean => varianceBreadcrumb('flags', key, flags[key] === true);

export function shipping(weight: number, flags: Flags): number {
  const base = weight * 3;
  return on(flags, 'express') ? express(base) : base;
}

function express(base: number): number {
  return base + 5;
}

export function fee(amount: number, flags: Flags): number {
  if (on(flags, 'fee')) {
    return amount + 2;
  } else {
    return amount + 1;
  }
}

export function tax(amount: number, flags: Flags): number {
  return on(flags, 'tax') ? amount * 4 : amount * 2;
}

export function tip(amount: number, flags: Flags): number {
  if (!on(flags, 'tip')) return amount * 3;
  return amount * 5;
}
`;

const TEST = `import { expect, it } from 'vitest';
import { fee, shipping, tax, tip } from '../src/pay.js';

it('ships standard', () => expect(shipping(1, {})).toBe(3));
it('ships express', () => expect(shipping(1, { express: true })).toBe(8));
it('charges the old fee', () => expect(fee(1, {})).toBe(2));
it('charges the new fee', () => expect(fee(1, { fee: true })).toBe(3));
it('taxes at the old rate', () => expect(tax(1, {})).toBe(2));
it('taxes at the new rate', () => expect(tax(1, { tax: true })).toBe(4));
it('tips the old share', () => expect(tip(1, {})).toBe(3));
it('tips the new share', () => expect(tip(1, { tip: true })).toBe(5));
`;

const CONFIG = `import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestSelection } from '@variance-authority/sense/vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');

export default withTestSelection(
  defineConfig({ root, test: { include: ['test/*.test.ts'], environment: 'node' } }),
  { coverageFile: process.env['VARIANCE_AUTHORITY_COVERAGE']!, include: (file) => file.startsWith(source) },
);
`;

const git = (at: string, args: readonly string[]): string =>
  execFileSync('git', args, { cwd: at, stdio: 'pipe', encoding: 'utf8' }).trim();

describe('a review of new code behind new flags, from a run on the change', () => {
  const cwd = process.cwd();
  const previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  let root: string;
  let cache: string;
  let answer: Review;
  let markdown: string;
  let first: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'variance-review-reads-'));
    cache = await mkdtemp(join(tmpdir(), 'variance-review-reads-cache-'));
    process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
    await mkdir(join(root, 'src'));
    await mkdir(join(root, 'test'));
    await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
    await writeFile(join(root, 'package.json'), '{ "name": "flags-fixture", "private": true, "type": "module" }\n');
    await writeFile(join(root, '.gitignore'), 'node_modules\n');
    await writeFile(join(root, 'vitest.config.ts'), CONFIG);
    await writeFile(join(root, 'src/pay.ts'), BEFORE);
    await writeFile(join(root, 'test/pay.test.ts'), TEST);
    git(root, ['init', '--quiet', '--initial-branch', 'main']);
    git(root, ['config', 'user.email', 'fixture@example.test']);
    git(root, ['config', 'user.name', 'Fixture']);
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'first']);
    first = git(root, ['rev-parse', 'HEAD']);
    await writeFile(join(root, 'src/pay.ts'), AFTER);
    await promisify(execFile)(
      process.execPath,
      [resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(root, 'vitest.config.ts')],
      { cwd: root, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: testCoverageFile(root) } },
    );
    await updateSourceIndex(root);
    process.chdir(root);
    const flags = readFlags(['--since', first, '--root', root], 'review', flagsFor('review'), synopsisFor('review'));
    answer = await review(parseReviewArgs(flags));
    markdown = formatReview(answer, 'markdown');
  }, 120_000);

  afterAll(async () => {
    process.chdir(cwd);
    if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
    else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
    await Promise.all([root, cache].map((path) => rm(path, { recursive: true, force: true })));
  });

  const region = (name: string) => answer.files.find((file) => file.file === 'src/pay.ts')?.regions?.find((one) => one.name === name);
  /** The function's row in the review comment. */
  const rowOf = (name: string) => markdown.split('\n').find((line) => line.includes(`| \`${name}\` |`));

  it('keeps each case\'s reads beside what it said in the JSON, with the site that read them', () => {
    const called = region('shipping')?.called;
    expect(called?.map((test) => [test.name, test.reads?.map((read) => [read.name, read.value, read.site])])).toEqual([
      ['ships express', [['flags:express', true, 'src/pay.ts:5']]],
      ['ships standard', [['flags:express', false, 'src/pay.ts:5']]],
    ]);
    expect(called?.every((test) => test.preconditions?.length === 0)).toBe(true);
  });

  it('shows a changed line outside the flag reached with the flag off, and new code behind it reached only with it on', () => {
    expect(rowOf('shipping')).toBe('| 🟢 | `shipping` | modified | `src/pay.ts:7-10` | 2; flags:express read false by 1, true by 1 | 2 | `test/pay.test.ts` |');
    expect(rowOf('express')).toBe('| 🟢 | `express` | new | `src/pay.ts:12-14` | 1; flags:express read true by 1 | 1 | `test/pay.test.ts` |');
  });

  it('shows old code moved into the flag-off arm reached with the flag off, by an else, a ternary and an early return', () => {
    expect(rowOf('fee')).toBe('| 🟢 | `fee` | modified | `src/pay.ts:16-22` | 2; flags:fee read false by 1, true by 1 | 2 | `test/pay.test.ts` |');
    expect(rowOf('tax')).toBe('| 🟢 | `tax` | modified | `src/pay.ts:24-26` | 2; flags:tax read false by 1, true by 1 | 2 | `test/pay.test.ts` |');
    expect(rowOf('tip')).toBe('| 🟢 | `tip` | modified | `src/pay.ts:28-31` | 2; flags:tip read false by 1, true by 1 | 2 | `test/pay.test.ts` |');
  });

  it('splits a helper every case entered by every key its cases read, and the cases that never read each', () => {
    expect(rowOf('on')).toBe('| 🟢 | `on` | new | `src/pay.ts:5` | 8; ' + ['express', 'fee', 'tax', 'tip']
      .map((key) => `flags:${key} read false by 1, true by 1, not by 6`).join('; ') + ' | 8 | `test/pay.test.ts` |');
  });
});
