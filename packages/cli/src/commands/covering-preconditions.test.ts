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
  encodeAsSetExecutionIndex,
  writeTestCoverage,
  type ExecutionIndex,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import { covering, formatCovering } from './covering.js';

/**
 * What a case said, printed beside it in every answer that lists it.
 *
 * Two test files say `flags:checkout=ff-on`, one of them also `flags:checkout=ff-off`, and
 * `c.test.ts` says nothing at all. The checkout declares `flag` an axis, and
 * no case is read against it: spec 0093 waits on spec 0102 for how an axis
 * names a `(dimension, key)` pair, so no case is given a twin.
 */
function said(file: string, name: string, flag?: string, line = 3): ExecutionTest {
  return {
    id: `${file} > ${name}`, file, name,
    said: JSON.stringify({ said: flag === undefined ? [] : [['flags:checkout', JSON.stringify(flag), `${file}:${line}`, 1]] }),
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

const AXES = JSON.stringify({ names: { axes: [{ axis: 'flags:checkout', values: ['ff-off', 'ff-half', 'ff-on'] }] } });

/** The record, outside the checkout: written into it, it is an untracked file in the diff. */
async function record(): Promise<string> {
  const execution = join(await mkdtemp(join(tmpdir(), 'variance-covering-said-')), 'coverage.bin');
  await writeTestCoverage(execution, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, {
    index: encodeAsSetExecutionIndex(INDEX),
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
  return formatCovering(await covering(parse([...argv, '--execution', execution, '--root', root])), 'text', Date.now());
}

describe('a listed case carries what it said', () => {
  it('prints it under a plain `--function`, with no `--where`, and no twin under it', async () => {
    const answer = await text(['--file', 'src/cart.ts', '--function', 'round']);

    expect(answer).toContain('    off — flags:checkout=ff-off (a.test.ts:8)\n    on — flags:checkout=ff-on (a.test.ts:3)\n');
    expect(answer).not.toContain('twin');
  });

  it('prints it in the whole-file answer, with no twin under it', async () => {
    const answer = await text(['--file', 'src/cart.ts']);

    expect(answer).toContain('    off — flags:checkout=ff-off (a.test.ts:8)\n    on — flags:checkout=ff-on (a.test.ts:3)\n');
    expect(answer).not.toContain('twin');
  });
});

describe('`--where` counts the cases that covered what was asked', () => {
  it('counts out of the cases that covered the function, not the whole record', async () => {
    const answer = await text(['--file', 'src/cart.ts', '--function', 'round', '--where', 'flags:checkout=ff-on']);

    expect(answer).toContain('Kept the 2 of 4 cases that covered function round of src/cart.ts and recorded flags:checkout=ff-on.\n');
  });

  it('says so when none of them recorded it', async () => {
    expect(await text(['--file', 'src/cart.ts', '--line', '6', '--where', 'flags:checkout=ff-half']))
      .toContain('Kept none of the 4 cases that covered line 6 of src/cart.ts: none recorded flags:checkout=ff-half.\n');
  });

  it('claims none recorded it only of the cases recorded with preconditions', () => {
    const answer = (unmeasured: number) => formatCovering({
      file: 'src/cart.ts', from: 'coverage.bin', target: { line: 6 }, tests: [],
      where: { asked: ['flags:checkout=ff-half'], kept: 0, of: 4, unmeasured },
    }, 'text', Date.now());

    expect(answer(1)).toContain('Kept none of the 4 cases that covered line 6 of src/cart.ts: none of the 3 with recorded preconditions has flags:checkout=ff-half.\n');
    expect(answer(1)).toContain('1 case was recorded without preconditions');
    expect(answer(4)).toContain('Kept none of the 4 cases that covered line 6 of src/cart.ts: none of them was recorded with preconditions.\n');
  });

  it('still counts a function found in a file whose recorded text is gone, since its cases are listed', () => {
    const answer = formatCovering({
      file: 'src/cart.ts', frame: 'stale', from: 'coverage.bin', target: { function: 'round' }, tests: [],
      where: { asked: ['flags:checkout=ff-on'], kept: 0, of: 0, unmeasured: 0 },
    }, 'text', Date.now());

    expect(answer).toContain('No case covered function round of src/cart.ts, so none recorded flags:checkout=ff-on.');
  });

  it('counts the whole-file answer out of the cases that covered the file', async () => {
    expect(await text(['--file', 'src/cart.ts', '--where', 'flags:checkout=ff-on']))
      .toContain('Kept the 2 of 5 cases that covered src/cart.ts and recorded flags:checkout=ff-on.\n');
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

  it('prints the preconditions, and no twin, on each case line of `--since`', async () => {
    const { root, execution } = await edited();

    const answer = formatCovering(await covering(parse(['--since', 'main', '--root', root, '--execution', execution])), 'text', Date.now());

    expect(answer).toContain('    a.test.ts > on — flags:checkout=ff-on (a.test.ts:3)\n');
    expect(answer).not.toContain('twin');
    expect(answer).toContain('    c.test.ts > plain\n');
  });

  it('counts `--where` out of the cases that covered the change', async () => {
    const { root, execution } = await edited();

    const answer = formatCovering(
      await covering(parse(['--since', 'main', '--root', root, '--execution', execution, '--where', 'flags:checkout=ff-on'])),
      'text', Date.now(),
    );

    expect(answer).toContain('Kept the 2 of 4 cases that covered the change since main and recorded flags:checkout=ff-on.\n');
  });
});
