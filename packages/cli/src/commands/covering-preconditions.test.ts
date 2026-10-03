import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { main } from '../bin.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import {
  encodeExecutionIndex,
  writeTestCoverage,
  type ExecutionIndex,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import { covering, formatCovering } from './covering.js';
import { caseNameOf, twinText } from './covering-where.js';

/**
 * What a case said, printed beside it in every answer that lists it.
 *
 * Two test files say `flag=ff-on`; only one of them also holds the case at the
 * base, so only that one has a twin. `c.test.ts` says nothing at all, and sits
 * at the base of every axis.
 */
function said(file: string, name: string, flag?: string, line = 3): ExecutionTest {
  return {
    id: `${file} > ${name}`, file, name,
    preconditions: flag === undefined ? [] : [{ name: 'flag', value: flag, site: `${file}:${line}`, level: 1 }],
  };
}

const TESTS: readonly ExecutionTest[] = [
  said('a.test.ts', 'on', 'ff-on'),
  said('a.test.ts', 'off', 'ff-off', 8),
  said('b.test.ts', 'also on', 'ff-on'),
  said('c.test.ts', 'plain'),
  said('c.test.ts', 'elsewhere'),
];

/** `total` is crossed by every case, `round` by all but the last. */
const INDEX: ExecutionIndex = {
  tests: TESTS,
  modules: [{
    file: 'src/cart.ts',
    blocks: [
      {
        kind: 'function', name: 'total', path: 'entry', startLine: 1, endLine: 3,
        source: true, crossings: TESTS.map((_, test) => ({ test, distance: 0 })),
      },
      {
        kind: 'function', name: 'round', path: 'entry', startLine: 5, endLine: 7,
        source: true, crossings: [0, 1, 2, 3].map((test) => ({ test, distance: 0 })),
      },
    ],
  }],
};

const AXES = JSON.stringify({ names: { axes: [{ axis: 'flag', values: ['ff-off', 'ff-half', 'ff-on'] }] } });

/** The record, outside the checkout: written into it, it is an untracked file in the diff. */
async function record(): Promise<string> {
  const execution = join(await mkdtemp(join(tmpdir(), 'variance-covering-said-')), 'coverage.bin');
  await writeTestCoverage(execution, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, {
    index: encodeExecutionIndex(INDEX),
  });
  return execution;
}

async function checkout(): Promise<{ root: string; execution: string }> {
  const root = await mkdtemp(join(tmpdir(), 'variance-covering-said-'));
  await writeFile(join(root, 'variance.config.json'), AXES);
  return { root, execution: await record() };
}

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

async function text(argv: readonly string[]): Promise<string> {
  const { root, execution } = await checkout();
  return formatCovering(await covering(parse([...argv, '--execution', execution, '--root', root])), 'text');
}

describe('a listed case carries what it said and its twin', () => {
  it('prints both under a plain `--function`, with no `--where`', async () => {
    const answer = await text(['--file', 'src/cart.ts', '--function', 'round']);

    expect(answer).toContain('    on — flag=ff-on (a.test.ts:3)\n      twin at flag=ff-off: off\n');
    expect(answer).toContain('    off — flag=ff-off (a.test.ts:8)\n');
  });

  it('takes a twin only from the case\'s own test file', async () => {
    // `a.test.ts > off` and `c.test.ts > plain` both stand at the base, and neither shares a file with this case.
    expect(await text(['--file', 'src/cart.ts', '--function', 'round']))
      .toContain('    also on — flag=ff-on (b.test.ts:3)\n      no twin recorded at flag=ff-off\n');
  });

  it('prints both in the whole-file answer', async () => {
    expect(await text(['--file', 'src/cart.ts'])).toContain('    on — flag=ff-on (a.test.ts:3)\n      twin at flag=ff-off: off\n');
  });

  it('names a twin by its case name, and by its whole id when the id holds no file part', () => {
    expect(caseNameOf('a.test.ts > checkout > pays')).toBe('checkout > pays');
    expect(caseNameOf('pays')).toBe('pays');
  });

  it('bounds a large twin set to a count and a few names', () => {
    const twin = { case: 'x', axis: 'flag', from: 'ff-on', to: 'ff-off', twins: ['a', 'b', 'c', 'd', 'e'] };

    expect(twinText(twin, (id) => id, '  ')).toBe('  5 twins at flag=ff-off: a, b, c, and 2 more');
    expect(twinText({ ...twin, twins: ['a', 'b', 'c'] }, (id) => id, '')).toBe('3 twins at flag=ff-off: a, b, c');
  });
});

describe('`--where` counts the cases that covered what was asked', () => {
  it('counts out of the cases that covered the function, not the whole record', async () => {
    const answer = await text(['--file', 'src/cart.ts', '--function', 'round', '--where', 'flag=ff-on']);

    expect(answer).toContain('Kept the 2 of 4 cases that covered function round of src/cart.ts and said flag=ff-on.\n');
  });

  it('says so when none of them said it', async () => {
    expect(await text(['--file', 'src/cart.ts', '--line', '6', '--where', 'flag=ff-half']))
      .toContain('Kept none of the 4 cases that covered line 6 of src/cart.ts: none said flag=ff-half.\n');
  });

  it('claims none said it only of the cases that were listened to', () => {
    const answer = (unmeasured: number) => formatCovering({
      file: 'src/cart.ts', from: 'coverage.bin', target: { line: 6 }, tests: [],
      where: { asked: ['flag=ff-half'], kept: 0, of: 4, unmeasured, outside: [] },
    }, 'text');

    expect(answer(1)).toContain('Kept none of the 4 cases that covered line 6 of src/cart.ts: none of the 3 listened to said flag=ff-half.\n');
    expect(answer(1)).toContain('1 case was not listened to');
    expect(answer(4)).toContain('Kept none of the 4 cases that covered line 6 of src/cart.ts: none of them was listened to.\n');
  });

  it('says no count over a file whose recorded text is gone, where no case can be placed', () => {
    const answer = formatCovering({
      file: 'src/cart.ts', frame: 'stale', from: 'coverage.bin',
      where: { asked: ['flag=ff-on'], kept: 0, of: 0, unmeasured: 0, outside: [] },
    }, 'text');

    expect(answer).not.toMatch(/No case covered|Kept/);
    expect(answer).toContain('src/cart.ts is not the text the suite ran over');
  });

  it('still counts a function found in a file whose recorded text is gone, since its cases are listed', () => {
    const answer = formatCovering({
      file: 'src/cart.ts', frame: 'stale', from: 'coverage.bin', target: { function: 'round' }, tests: [],
      where: { asked: ['flag=ff-on'], kept: 0, of: 0, unmeasured: 0, outside: [] },
    }, 'text');

    expect(answer).toContain('No case covered function round of src/cart.ts, so none said flag=ff-on.');
  });

  it('counts the whole-file answer out of the cases that covered the file', async () => {
    expect(await text(['--file', 'src/cart.ts', '--where', 'flag=ff-on']))
      .toContain('Kept the 2 of 5 cases that covered src/cart.ts and said flag=ff-on.\n');
  });
});

describe('the review reading carries what each case said', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  const git = (at: string, args: readonly string[]): void => {
    execFileSync('git', args, { cwd: at, stdio: 'pipe' });
  };

  /** A checkout whose `round` was edited since `main`, indexed and run from inside it as `--since` is. */
  async function edited(): Promise<{ root: string; execution: string }> {
    const { root, execution } = await checkout();
    await mkdir(join(root, 'src'));
    const body = (edit: boolean) => Array.from({ length: 10 }, (_, at) => `const line${at + 1} = ${at + 1};${edit && at === 5 ? ' // edited' : ''}`).join('\n');
    await writeFile(join(root, 'src/cart.ts'), `${body(false)}\n`);
    git(root, ['init', '--quiet', '--initial-branch', 'main']);
    git(root, ['config', 'user.email', 'fixture@example.test']);
    git(root, ['config', 'user.name', 'Fixture']);
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'first']);
    await writeFile(join(root, 'src/cart.ts'), `${body(true)}\n`);
    process.chdir(root);
    // Under CI nothing builds the source index implicitly; `variance index` is the step that publishes it.
    let err = '';
    const indexed = await main(['index'], { out: () => {}, err: (text) => (err += text) });
    if (indexed !== 0) throw new Error(`variance index failed in ${root}: ${err}`);
    return { root, execution };
  }

  it('prints the preconditions and the twin on each case line of `--since`', async () => {
    const { root, execution } = await edited();

    const answer = formatCovering(await covering(parse(['--since', 'main', '--root', root, '--execution', execution])), 'text');

    expect(answer).toContain('    a.test.ts > on — flag=ff-on (a.test.ts:3)\n      twin at flag=ff-off: off\n');
    expect(answer).toContain('    c.test.ts > plain\n');
  });

  it('counts `--where` out of the cases that covered the change', async () => {
    const { root, execution } = await edited();

    const answer = formatCovering(
      await covering(parse(['--since', 'main', '--root', root, '--execution', execution, '--where', 'flag=ff-on'])),
      'text',
    );

    expect(answer).toContain('Kept the 2 of 4 cases that covered the change since main and said flag=ff-on.\n');
  });
});
