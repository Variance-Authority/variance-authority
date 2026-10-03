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

/**
 * `--where flag=ff-on` keeps one case of three, and every other case either ran
 * the code or stopped before it. A region's state is a claim about every case
 * that could have gone there, so it is read before `--where` narrows them.
 */
function said(file: string, name: string, flag: string, stopped: boolean): ExecutionTest {
  return {
    id: `${file} > ${name}`, file, name, stopped,
    preconditions: [{ name: 'flag', value: flag, site: `${file}:3`, level: 1 }],
  };
}

const TESTS: readonly ExecutionTest[] = [
  said('a.test.ts', 'on', 'ff-on', false),
  said('a.test.ts', 'off', 'ff-off', false),
  said('b.test.ts', 'stops', 'ff-off', true),
];

function block(name: string, startLine: number, tests: readonly number[]): ExecutionIndex['modules'][number]['blocks'][number] {
  return {
    kind: 'function', name, path: 'entry', startLine, endLine: startLine + 2,
    source: true, crossings: tests.map((test) => ({ test, distance: 0 })),
  };
}

/**
 * `total` is run by both finished cases, `round` by the kept one alone,
 * `discount` by nobody, and `fee` by a case `--where` leaves out. The third
 * case imports the module and stopped before entering any of them.
 */
const INDEX: ExecutionIndex = {
  tests: TESTS,
  modules: [{
    file: 'src/cart.ts',
    blocks: [block('total', 1, [0, 1]), block('round', 5, [0]), block('discount', 9, []), block('fee', 13, [1])],
  }],
};

const git = (at: string, args: readonly string[]): void => {
  execFileSync('git', args, { cwd: at, stdio: 'pipe' });
};

/** A checkout whose test files import `src/cart.ts`, with every function edited since `main`, run from inside it. */
async function checkout(): Promise<{ root: string; execution: string }> {
  const root = await mkdtemp(join(tmpdir(), 'variance-covering-where-state-'));
  const execution = join(await mkdtemp(join(tmpdir(), 'variance-covering-where-state-')), 'coverage.bin');
  await writeTestCoverage(execution, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, {
    index: encodeExecutionIndex(INDEX),
  });
  const cart = (edit: boolean) => ['total', 'round', 'discount', 'fee']
    .map((name, at) => `export function ${name}() {\n  return ${at};${edit ? ' // edited' : ''}\n}\n`).join('\n');
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/cart.ts'), cart(false));
  for (const file of ['a.test.ts', 'b.test.ts']) await writeFile(join(root, file), "import { total } from './src/cart';\n\ntotal();\n");
  git(root, ['init', '--quiet', '--initial-branch', 'main']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'first']);
  await writeFile(join(root, 'src/cart.ts'), cart(true));
  process.chdir(root);
  // Under CI nothing builds the source index implicitly; `variance index` is the step that publishes it.
  let err = '';
  const indexed = await main(['index'], { out: () => {}, err: (text) => (err += text) });
  if (indexed !== 0) throw new Error(`variance index failed in ${root}: ${err}`);
  return { root, execution };
}

function ask(record: { root: string; execution: string }, argv: readonly string[]) {
  return covering(parseCoveringArgs(readFlags(
    [...argv, '--execution', record.execution, '--root', record.root],
    'covering', flagsFor('covering'), synopsisFor('covering'),
  )));
}

const ids = (tests: readonly ExecutionTest[] | undefined) => tests?.map((test) => test.id);

describe('`--where` narrows the cases listed, never the state of what they covered', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it('keeps a line other cases also ran walked, and says no "only case"', async () => {
    const record = await checkout();

    const answer = await ask(record, ['--file', 'src/cart.ts', '--line', '2', '--where', 'flag=ff-on']);

    expect(ids(answer.tests)).toEqual(['a.test.ts > on']);
    expect(answer.state).toBe('walked');
    expect(formatCovering(answer, 'text')).toContain('1 named test covered line 2 of src/cart.ts:\n');
  });

  it('keeps a function walked, and names the case that stopped, when `--where` left out the stopped case', async () => {
    const record = await checkout();

    const answer = await ask(record, ['--file', 'src/cart.ts', '--function', 'round', '--where', 'flag=ff-on']);

    expect(ids(answer.tests)).toEqual(['a.test.ts > on']);
    expect(ids(answer.stopped)).toEqual(['b.test.ts > stops']);
    expect(answer.state).toBe('walked');
  });

  it('keeps a hole a hole when `--where` left out the case that stopped', async () => {
    const record = await checkout();

    const answer = await ask(record, ['--file', 'src/cart.ts', '--line', '10', '--where', 'flag=ff-on']);

    expect(answer.state).toBe('hole');
    expect(formatCovering(answer, 'text')).toContain('a hole: a case that could have reached it stopped first');
  });

  it('states each range of the whole file over every case, and lists only the kept ones', async () => {
    const record = await checkout();

    const answer = await ask(record, ['--file', 'src/cart.ts', '--where', 'flag=ff-on']);

    expect(answer.ranges?.map((range) => [range.startLine, range.endLine, range.state, ids(range.tests)])).toEqual([
      [1, 3, 'walked', ['a.test.ts > on']],
      [5, 7, 'walked', ['a.test.ts > on']],
      [9, 11, 'hole', []],
      [13, 15, 'walked', []],
    ]);
    const text = formatCovering(answer, 'text');
    expect(text).toContain('lines 13-15 — walked\n  no case `--where` kept covered this range\n');
    expect(text).not.toContain('unwalked');
  });

  it('states each changed region over every case', async () => {
    const record = await checkout();

    const answer = await ask(record, ['--since', 'main', '--where', 'flag=ff-on']);

    expect(answer.changed?.[0]?.regions.map((region) => [region.name, region.state, ids(region.tests), ids(region.stopped)])).toEqual([
      ['total', 'walked', ['a.test.ts > on'], ['b.test.ts > stops']],
      ['round', 'walked', ['a.test.ts > on'], ['b.test.ts > stops']],
      ['discount', 'hole', [], ['b.test.ts > stops']],
      ['fee', 'walked', [], ['b.test.ts > stops']],
    ]);
  });

  it.todo(
    'the `--since` text words `fee` as walked by a case `--where` left out, not as a hole nobody covered — needs ' +
      '`formatCoveringChange` in sense, which the MCP tool shares, to word a region from its `state`',
  );
});
