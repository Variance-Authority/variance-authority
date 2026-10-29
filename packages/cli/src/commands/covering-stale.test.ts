import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import {
  encodeAsSetExecutionIndex,
  writeTestCoverage,
  type ExecutionIndex,
  type ExecutionTest,
  type Placement,
} from '@variance-authority/sense/test-selection';
import { INSTRUMENTATION_ID } from '@variance-authority/sense/instrument';
import { digestString } from '@variance-authority/core/format';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';
import { indexOutput } from './index-command.js';

/**
 * A file edited since the recording, whose recorded text is in neither git nor
 * the kept texts: no recorded line is a place in what is held. Framing it end
 * to end needs a record whose commit git does not hold, so the frame is stood
 * in for.
 */
const STALE: Placement = { frame: 'stale', at: '0123456789abcdef', place: () => undefined, recordedLine: () => undefined };

vi.mock('./covering-frame.js', async (original) => ({
  ...await original<typeof import('./covering-frame.js')>(),
  placementFor: async () => STALE,
}));

function said(name: string, flag?: string): ExecutionTest {
  const file = 'a.test.ts';
  return { id: `${file} > ${name}`, file, name, said: JSON.stringify({ said: flag === undefined ? [] : [['flags:checkout', JSON.stringify(flag), `${file}:3`, 1]] }) };
}

const TESTS: readonly ExecutionTest[] = [said('on', 'ff-on'), said('off', 'ff-off'), said('plain')];

/** `total` is crossed by every case, `round` by the first two. */
const INDEX: ExecutionIndex = {
  tests: TESTS,
  modules: [{
    file: 'src/cart.ts',
    blocks: [
      { kind: 'function', name: 'total', path: 'entry', startLine: 1, endLine: 3, source: true, crossings: [0, 1, 2].map((test) => ({ test, distance: 0 })) },
      { kind: 'function', name: 'round', path: 'entry', startLine: 5, endLine: 7, source: true, crossings: [0, 1].map((test) => ({ test, distance: 0 })) },
    ],
  }, {
    file: 'src/other.ts',
    blocks: [{ kind: 'function', name: 'other', path: 'entry', startLine: 1, endLine: 2, source: true, crossings: [] }],
  }],
};

async function ask(argv: readonly string[]) {
  const root = await mkdtemp(join(tmpdir(), 'variance-covering-stale-'));
  const execution = join(root, 'coverage.bin');
  // Under CI nothing builds the source index implicitly; the fixture publishes it, as the pipeline's `variance index` step does.
  execFileSync('git', ['init', '--quiet', root]);
  await updateSourceIndex(root);
  // `a.test.ts` ran whole and entered `src/cart.ts`, so selection names it for the file.
  const cart = {
    file: 'src/cart.ts',
    sourceDigest: digestString('recorded cart'),
    instrumented: true,
    blocks: [{
      ordinal: 0, kind: 'module' as const, digest: digestString('module src/cart.ts'), name: 'src/cart.ts', path: 'module',
      startLine: 1, endLine: 7, source: true, testFiles: ['a.test.ts'],
    }],
  };
  await writeTestCoverage(execution, {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }],
    modules: [cart],
  }, {
    index: encodeAsSetExecutionIndex(INDEX),
  });
  return asked(root, execution, argv);
}

function asked(root: string, execution: string, argv: readonly string[]) {
  return covering(parseCoveringArgs(readFlags(
    ['--file', 'src/cart.ts', '--execution', execution, '--root', root, ...argv],
    'covering', flagsFor('covering'), synopsisFor('covering'),
  )));
}

const GONE = 'src/cart.ts is not the text the suite ran over at 0123456789ab, and that text could not be found, so no recorded line is a place in it.';

describe('a file whose recorded text is gone', () => {
  it('names the cases that ran code in the file, and says the line is what it cannot place', async () => {
    const answer = await ask(['--line', '6']);
    const text = formatCovering(answer, 'text');

    expect(answer).toMatchObject({ frame: 'stale', target: { line: 6 }, at: '0123456789abcdef' });
    expect(answer.tests?.map((test) => test.name)).toEqual(['off', 'on', 'plain']);
    expect(text).toContain(`${GONE}\n3 named tests ran code in src/cart.ts; which of them ran line 6 cannot be said:\n  a.test.ts — 3/3\n    off — flags:checkout=ff-off`);
    expect(answer.gap).toEqual({
      question: 'which of these tests ran it',
      scope: 'line 6 of src/cart.ts',
      known: '3 named tests ran code in src/cart.ts',
      reason: 'stale',
      remedy: 'record',
      run: { files: ['a.test.ts'] },
      next: [],
      cost: { tests: 3, files: 1 },
    });
    expect(text.trimEnd().endsWith("Next, Record, 3 tests in 1 test file:\n  Run with the suite's own runner: a.test.ts")).toBe(true);
  });

  it('answers the whole file the same way, with no range in it', async () => {
    const answer = await ask([]);

    expect(answer.ranges).toBeUndefined();
    expect(answer.tests?.map((test) => test.name)).toEqual(['off', 'on', 'plain']);
    expect(formatCovering(answer, 'text')).toContain(`${GONE}\n3 named tests ran code in src/cart.ts; at which of its lines cannot be said:\n`);
  });

  it('numbers the cases in refs, and says the same gap', async () => {
    const refs = formatCovering(await ask(['--line', '6']), 'refs');

    expect(refs).toContain(`${GONE}\n3 named tests ran code in src/cart.ts; which of them ran line 6 cannot be said: 1-3\n`);
    expect(refs).not.toMatch(/[Rr]un the suite/);
  });

  it('counts `--where` out of the cases that ran code in the file, not out of a line it cannot place', async () => {
    const text = formatCovering(await ask(['--line', '6', '--where', 'flags:checkout=ff-on']), 'text');

    expect(text).toContain('Kept the 1 of 3 cases that covered src/cart.ts and recorded flags:checkout=ff-on.\n');
    expect(text).toContain('1 named test ran code in src/cart.ts; which of them ran line 6 cannot be said:');
  });
});

/**
 * The stale answer reads the file graph on the same signal as the fresh one:
 * load time marked on a block or on a crossing. Here only the crossing says
 * it, and no case stopped.
 */
describe('a stale file only a mock evaluated', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it('names no case for the mock evaluating it, as the fresh answer does', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-covering-stale-mocked-'));
    const git = (args: readonly string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    };
    await mkdir(join(root, 'src'), { recursive: true });
    git(['init', '--quiet', '--initial-branch', 'main']);
    git(['config', 'user.email', 'fixture@example.test']);
    git(['config', 'user.name', 'Fixture']);
    await writeFile(join(root, 'src/cart.ts'), 'export const total = 1;\n');
    await writeFile(
      join(root, 'mocked.test.ts'),
      "import { vi } from 'vitest';\nimport { total } from './src/cart';\nvi.mock('./src/cart');\nit('stubs', () => total);\n",
    );
    git(['add', '-A']);
    git(['commit', '--quiet', '-m', 'first']);
    process.chdir(root);
    await indexOutput({ cwd: root });
    // A JSON record keeps the mark on the crossing; the binary one folds it onto the block.
    const execution = join(await mkdtemp(join(tmpdir(), 'variance-covering-stale-record-')), 'cases.json');
    await writeFile(execution, JSON.stringify({
      tests: [{ id: 'mocked.test.ts > stubs', file: 'mocked.test.ts', name: 'stubs', stopped: false }],
      modules: [{
        file: 'src/cart.ts',
        blocks: [{ kind: 'statement', name: 'total', path: 'statement#0', startLine: 1, endLine: 1, source: true, crossings: [{ test: 0, distance: 0, loaded: true }] }],
      }],
    }));

    const answers = [await asked(root, execution, []), await asked(root, execution, ['--line', '1'])];

    expect(answers.map((answer) => [answer.frame, answer.tests])).toEqual([['stale', []], ['stale', []]]);
  });
});
