import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import {
  caseLayerFiles,
  encodeExecutionIndex,
  type ExecutionBlock,
  type ExecutionIndex,
} from '@variance-authority/sense/test-selection';
import { covering, formatCovering } from './covering.js';
import { indexOutput } from './index-command.js';

const DISCOUNTS = { id: 'total.test.ts > discounts', file: 'total.test.ts', name: 'discounts', stopped: false };
const CHECKS_OUT = { id: 'flow.test.tsx > checks out', file: 'flow.test.tsx', name: 'checks out', stopped: false };

function block(name: string, startLine: number, tests: readonly number[]): ExecutionBlock {
  return {
    kind: 'function', name, path: 'entry', startLine, endLine: startLine + 4, source: true,
    crossings: tests.map((test) => ({ test, distance: 0 })),
  };
}

function index(apply: readonly number[], round: readonly number[], other?: readonly number[]): ExecutionIndex {
  return {
    tests: [DISCOUNTS, CHECKS_OUT],
    modules: [
      { file: 'src/total.ts', blocks: [block('applyDiscount', 10, apply), block('round', 30, round)] },
      ...(other === undefined ? [] : [{ file: 'src/other.ts', blocks: [block('format', 1, other)] }]),
    ],
  };
}

function parse(argv: readonly string[]) {
  return parseCoveringArgs(readFlags(argv, 'covering', flagsFor('covering'), synopsisFor('covering')));
}

/** A directory outside any checkout, so an index written there is never part of a diff. */
async function records(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'variance-covering-motion-'));
}

describe('what the last run moved', () => {
  it('compares the last run with the cases it retired, and names what a test stopped calling', async () => {
    const dir = await records();
    const execution = join(dir, 'cases.bin');
    await writeFile(execution, encodeExecutionIndex(index([0, 1], [1])));
    await writeFile(caseLayerFiles(execution).last, JSON.stringify({ at: '2026-09-25T00:00:00.000Z', files: ['total.test.ts'], cases: [DISCOUNTS.id] }));
    await writeFile(caseLayerFiles(execution).before, encodeExecutionIndex({ tests: [DISCOUNTS], modules: [
      { file: 'src/total.ts', blocks: [block('applyDiscount', 10, [0]), block('round', 30, [0])] },
    ] }));

    const answer = await covering(parse(['--file', 'src/total.ts', '--cases', 'last', '--execution', execution]));

    expect(answer.motion?.moved?.regions.map((region) => [region.name, region.motion])).toEqual([['round', 'lost']]);
    const text = formatCovering(answer, 'text');
    expect(text).toContain('Against the run before it: 1 lost, 0 hidden, 0 thinned, 0 gained.');
    expect(text).toContain('  lost     src/total.ts 30-34 function round — was total.test.ts > discounts');
    expect(text).toContain('total.test.ts now enters 0 regions it did not, and no longer enters 1.');
  });

  it('says there was nothing to compare when no run came before', async () => {
    const dir = await records();
    const execution = join(dir, 'cases.bin');
    await writeFile(execution, encodeExecutionIndex(index([0], [])));
    await writeFile(caseLayerFiles(execution).last, JSON.stringify({ at: '2026-09-25T00:00:00.000Z', files: [], cases: [DISCOUNTS.id] }));

    const answer = await covering(parse(['--file', 'src/total.ts', '--cases', 'last', '--execution', execution]));

    expect(answer.motion?.moved).toBeUndefined();
    expect(formatCovering(answer, 'text')).toContain('Nothing to compare:');
  });
});

describe('what a change moved against the base', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  const git = (at: string, args: readonly string[]): string =>
    execFileSync('git', args, { cwd: at, stdio: 'pipe', encoding: 'utf8' }).trim();

  /** A checkout with `main` at `first`, and the change on a branch of its own. */
  async function checkout(): Promise<{ root: string; first: string }> {
    const root = await mkdtemp(join(tmpdir(), 'variance-covering-against-'));
    await mkdir(join(root, 'src'), { recursive: true });
    git(root, ['init', '--quiet', '--initial-branch', 'main']);
    git(root, ['config', 'user.email', 'fixture@example.test']);
    git(root, ['config', 'user.name', 'Fixture']);
    await writeFile(join(root, 'src/total.ts'), 'export const total = 1;\n');
    await writeFile(join(root, 'src/other.ts'), 'export const other = 1;\n');
    await writeFile(join(root, 'total.test.ts'), 'it("discounts", () => {});\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '--quiet', '-m', 'first']);
    process.chdir(root);
    return { root, first: git(root, ['rev-parse', 'HEAD']) };
  }

  async function recorded(base: ExecutionIndex, now: ExecutionIndex, commit: string) {
    const dir = await records();
    const against = join(dir, 'base.cases.bin');
    await writeFile(against, encodeExecutionIndex(base));
    await writeFile(caseLayerFiles(against).last, JSON.stringify({ commit, at: '2026-09-25T00:00:00.000Z', files: [], cases: [] }));
    const execution = join(dir, 'cases.bin');
    await writeFile(execution, encodeExecutionIndex(now));
    // The pipeline step a CI run needs before `--since`, taken the way a pipeline takes it.
    await indexOutput({ cwd: process.cwd() });
    return { against, execution };
  }

  it('names a region no case walks any more as lost, though the diff never touched its file', async () => {
    const { root, first } = await checkout();
    git(root, ['checkout', '--quiet', '-b', 'change']);
    await writeFile(join(root, 'total.test.ts'), 'it("discounts", () => { /* no round */ });\n');
    const { against, execution } = await recorded(index([0, 1], [0]), index([0, 1], []), first);

    const answer = await covering(parse(['--since', 'main', '--against', against, '--execution', execution]));

    expect(answer.motion?.base).toMatchObject({ at: first, mergeBase: first, leftOut: [] });
    expect(answer.motion?.moved?.counts).toEqual({ lost: 1, hidden: 0, thinned: 0, gained: 0 });
    expect(formatCovering(answer, 'text')).toContain(`Against ${against} at ${first.slice(0, 12)}: 1 lost`);
    expect(JSON.parse(formatCovering(answer, 'json')).motion.moved.regions[0].name).toBe('round');
  });

  it('names the moved regions\' cases by the numbers of the refs table, and each case once', async () => {
    const { root, first } = await checkout();
    git(root, ['checkout', '--quiet', '-b', 'change']);
    await writeFile(join(root, 'total.test.ts'), 'it("discounts", () => { /* no round */ });\n');
    const { against, execution } = await recorded(index([0, 1], [0]), index([0, 1], []), first);

    const refs = formatCovering(
      await covering(parse(['--since', 'main', '--against', against, '--execution', execution])),
      'refs',
    );

    expect(refs).toContain('  lost     src/total.ts 30-34 function round — was 1\n');
    expect(refs.split(DISCOUNTS.name)).toHaveLength(2);
    expect(refs).not.toContain(DISCOUNTS.id);
  });

  it('says no region moved in those words', async () => {
    const { root, first } = await checkout();
    await writeFile(join(root, 'total.test.ts'), 'it("discounts", () => { });\n');
    const { against, execution } = await recorded(index([0], [1]), index([0], [1]), first);

    const answer = await covering(parse(['--since', 'main', '--against', against, '--execution', execution]));

    expect(formatCovering(answer, 'text')).toContain('no region moved.');
  });

  it('leaves out what the base branch changed after the base was recorded, and names it', async () => {
    const { root, first } = await checkout();
    await writeFile(join(root, 'src/other.ts'), 'export const other = 2;\n');
    git(root, ['commit', '--quiet', '-am', 'main moves']);
    git(root, ['checkout', '--quiet', '-b', 'change']);
    await writeFile(join(root, 'total.test.ts'), 'it("discounts", () => { });\n');
    const { against, execution } = await recorded(index([0], [1], [0]), index([0], [1], []), first);

    const answer = await covering(parse(['--since', 'main', '--against', against, '--execution', execution]));

    expect(answer.motion?.base.leftOut).toEqual(['src/other.ts']);
    expect(answer.motion?.moved?.regions).toEqual([]);
    expect(formatCovering(answer, 'text')).toContain('Left out, changed on the base\'s branch between');
  });

  it('refuses a base it cannot read, and says how a pipeline restores one', async () => {
    const { root } = await checkout();
    await writeFile(join(root, 'total.test.ts'), 'it("discounts", () => { });\n');
    const { execution } = await recorded(index([0], []), index([0], []), 'HEAD');

    await expect(covering(parse(['--since', 'main', '--against', join(root, 'missing.bin'), '--execution', execution])))
      .rejects.toThrow(/restore it from the cache/);
  });

  it('refuses `--against` without a diff', () => {
    expect(() => parse(['--file', 'src/total.ts', '--against', 'base.bin'])).toThrow(/takes `--since <ref>`/);
  });
});
