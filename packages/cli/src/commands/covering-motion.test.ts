import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import {
  encodeExecutionIndex,
  writeTestCoverage,
  type CommitRuns,
  type ExecutionBlock,
  type ExecutionIndex,
} from '@variance-authority/sense/test-selection';
import { covering, formatCovering } from './covering.js';
import { motionOfLast, motionOfRuns, motionText, runsWrote } from './covering-motion.js';
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

/**
 * A record at `file` holding `now` as its case index, with the before layer
 * and the last run's name when given, the way a run keeps them. It holds no
 * coverage of its own: the question here reads only its cases.
 */
async function keep(file: string, now: ExecutionIndex, layers: { readonly before?: ExecutionIndex; readonly last?: object } = {}): Promise<void> {
  await writeTestCoverage(file, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, {
    index: encodeExecutionIndex(now),
    ...(layers.before === undefined ? {} : { before: encodeExecutionIndex(layers.before) }),
    ...(layers.last === undefined ? {} : { last: Buffer.from(JSON.stringify(layers.last)) }),
  });
}

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

/** A commit no clone has: forty hex digits that name no object. */
const ABSENT = 'f'.repeat(40);

/** The cases `discounts` ran at the base: both functions. */
const RETIRED: ExecutionIndex = {
  tests: [DISCOUNTS],
  modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 10, [0]), block('round', 30, [0])] }],
};

describe('what the last run moved', () => {
  it('compares the last run with the cases it retired, and names what a test stopped calling', async () => {
    const { first } = await checkout();
    const execution = join(await records(), 'coverage.bin');
    // No case of the record calls `round` now, the retained `flow.test.tsx` included.
    await keep(execution, index([0, 1], []), {
      last: { commit: first, before: first, at: '2026-09-25T00:00:00.000Z', files: ['total.test.ts'], cases: [DISCOUNTS.id] },
      before: RETIRED,
    });

    const answer = await covering(parse(['--file', 'src/total.ts', '--cases', 'last', '--execution', execution]));

    expect(answer.motion?.moved?.regions.map((region) => [region.name, region.motion])).toEqual([['round', 'lost']]);
    const text = formatCovering(answer, 'text');
    expect(text).toContain(`Against the run before it at ${first.slice(0, 12)}: 1 lost.`);
    expect(text).toContain('  lost     src/total.ts 30-34 function round — was total.test.ts > discounts');
    expect(text).toContain('total.test.ts no longer enters round in src/total.ts (1 region).');
  });

  it('credits no case an earlier run at the same commit recorded as kept from before it', async () => {
    // Two runs at one commit: the first ran `flow.test.tsx`, the last
    // `total.test.ts`, and both now call `round`, which no case called before.
    // `flow.test.tsx`'s case is new at this commit, not kept from an earlier
    // recording, so it says nothing of what `round` had before.
    const { first } = await checkout();
    const execution = join(await records(), 'coverage.bin');
    await keep(execution, index([0], [0, 1]), {
      last: { commit: first, before: first, at: '2026-09-25T00:00:00.000Z', files: ['flow.test.tsx', 'total.test.ts'], cases: [DISCOUNTS.id] },
      before: { tests: [DISCOUNTS, CHECKS_OUT], modules: [
        { file: 'src/total.ts', blocks: [block('applyDiscount', 10, [0]), block('round', 30, [])] },
      ] },
    });

    const answer = await covering(parse(['--file', 'src/total.ts', '--cases', 'last', '--execution', execution]));

    expect(answer.motion?.moved?.regions.map((region) => [region.name, region.motion])).toEqual([['round', 'gained']]);
  });

  it('says there was nothing to compare when no run came before', async () => {
    const dir = await records();
    const execution = join(dir, 'coverage.bin');
    await keep(execution, index([0], []), { last: { at: '2026-09-25T00:00:00.000Z', files: [], cases: [DISCOUNTS.id] } });

    const answer = await covering(parse(['--file', 'src/total.ts', '--cases', 'last', '--execution', execution]));

    expect(answer.motion?.moved).toBeUndefined();
    expect(formatCovering(answer, 'text')).toContain('Nothing to compare:');
  });

  it('refuses cases it retired that name no commit, and says when that happens', async () => {
    const { first } = await checkout();
    const execution = join(await records(), 'coverage.bin');
    // A run at the commit the last one was made at ran the file again, so what
    // it retired was recorded over more than one tree and names no `before`.
    await keep(execution, index([0, 1], [1]), {
      last: { commit: first, at: '2026-09-25T00:00:00.000Z', files: ['total.test.ts'], cases: [DISCOUNTS.id] },
      before: RETIRED,
    });

    await expect(covering(parse(['--file', 'src/total.ts', '--cases', 'last', '--execution', execution]))).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining('The run before the last one names no commit it was recorded at'),
    });
    await expect(covering(parse(['--file', 'src/total.ts', '--cases', 'last', '--execution', execution]))).rejects.toThrow(
      'a run at the same commit ran one of its test files again',
    );
  });

  it('refuses cases it retired at a commit this clone does not have, and names how to fetch it', async () => {
    await checkout();
    const execution = join(await records(), 'coverage.bin');
    await keep(execution, index([0, 1], [1]), {
      last: { commit: ABSENT, before: ABSENT, at: '2026-09-25T00:00:00.000Z', files: ['total.test.ts'], cases: [DISCOUNTS.id] },
      before: RETIRED,
    });

    const refused = covering(parse(['--file', 'src/total.ts', '--cases', 'last', '--execution', execution]));

    await expect(refused).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining(`was recorded at ${ABSENT}, which this clone does not have`),
    });
    await expect(refused).rejects.toThrow(`git fetch origin ${ABSENT}`);
  });

  it('compares nothing with cases it retired that do not read', async () => {
    const { first } = await checkout();
    const execution = join(await records(), 'coverage.bin');
    await writeTestCoverage(execution, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, {
      index: encodeExecutionIndex(index([0, 1], [1])),
      before: Buffer.from('not a case index'),
      last: Buffer.from(JSON.stringify({ commit: first, before: first, at: '2026-09-25T00:00:00.000Z', files: ['total.test.ts'], cases: [DISCOUNTS.id] })),
    });

    const answer = await covering(parse(['--file', 'src/total.ts', '--cases', 'last', '--execution', execution]));

    expect(answer.motion?.base).toEqual({ from: execution, kind: 'before', at: first });
    expect(answer.motion?.moved).toBeUndefined();
  });
});

describe('what the runs at one commit moved', () => {
  it('compares only the files a run before them recorded, and names the rest', async () => {
    // TanStack Query's first cycle: a whole run into an empty cache, then the
    // selected file again. `flow.test.tsx` ran once, over no index, so no case
    // of it came before, and `round`, which only it enters, gained nothing.
    const { root, first } = await checkout();
    const execution = join(await records(), 'coverage.bin');
    const full = index([0], [1]);
    await keep(execution, full, {
      last: {
        commit: 'c', before: first, at: '2026-09-25T00:00:00.000Z', files: ['flow.test.tsx', 'total.test.ts'],
        unbased: ['flow.test.tsx'], cases: [DISCOUNTS.id],
      },
      before: { tests: [DISCOUNTS], modules: [
        { file: 'src/total.ts', blocks: [block('applyDiscount', 10, [0]), block('round', 30, [])] },
      ] },
    });

    const wrote = await runsWrote(execution, { commit: 'c', files: ['flow.test.tsx', 'total.test.ts'] } as CommitRuns);
    const motion = await motionOfRuns(full, execution, wrote, root);

    expect(motion.moved?.regions).toEqual([]);
    expect(motion.unbased).toEqual(['flow.test.tsx']);
    expect(motion.unwritten).toEqual([]);
    expect(motionText(motion)).toContain('Not compared, no case of these was recorded before this commit\'s first run: flow.test.tsx.');
  });

  it('keeps the cases of a test file that did not run again on both sides of a region', async () => {
    // Only `total.test.ts` ran at this commit. It stopped calling `round` and
    // started calling `format`, but `flow.test.tsx`, which did not run again,
    // retains its earlier recording of both: `round` kept one case rather than
    // losing every case, and `format` gained none it did not have.
    const { root, first } = await checkout();
    const execution = join(await records(), 'coverage.bin');
    const full = index([0], [1], [0, 1]);
    await keep(execution, full, {
      last: { commit: first, before: first, at: '2026-09-25T00:00:00.000Z', files: ['total.test.ts'], cases: [DISCOUNTS.id] },
      before: { tests: [DISCOUNTS], modules: [
        { file: 'src/total.ts', blocks: [block('applyDiscount', 10, [0]), block('round', 30, [0])] },
        { file: 'src/other.ts', blocks: [block('format', 1, [])] },
      ] },
    });

    const wrote = await runsWrote(execution, { commit: first, files: ['total.test.ts'] } as CommitRuns);
    const motion = await motionOfRuns(full, execution, wrote, root);

    expect(motion.moved?.regions.map((region) => [region.name, region.motion])).toEqual([['round', 'thinned']]);
    const text = motionText(motion);
    expect(text).toContain(`Against the run before it at ${first.slice(0, 12)}: 1 thinned.`);
    expect(text).toContain('  thinned  src/total.ts 30-34 function round — was 2 cases, now only flow.test.tsx > checks out');
    expect(text).toContain('total.test.ts now enters format in src/other.ts (1 region), and no longer enters round in src/total.ts (1 region).');
  });
});

describe('what a change moved against the base', () => {
  async function recorded(base: ExecutionIndex, now: ExecutionIndex, commit: string | undefined) {
    const dir = await records();
    const against = join(dir, 'base.bin');
    await keep(against, base, { last: { commit, at: '2026-09-25T00:00:00.000Z', files: [], cases: [] } });
    const execution = join(dir, 'coverage.bin');
    await keep(execution, now);
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

  it('reads the cases the run retired as the base, at the commit they were recorded at', async () => {
    const { root, first } = await checkout();
    await writeFile(join(root, 'src/other.ts'), 'export const other = 2;\n');
    git(root, ['commit', '--quiet', '-am', 'main moves']);
    git(root, ['checkout', '--quiet', '-b', 'change']);
    const dir = await records();
    const execution = join(dir, 'coverage.bin');
    const now = index([0], [1], []);
    await keep(execution, now, {
      before: index([0], [1], [0]),
      last: { commit: git(root, ['rev-parse', 'HEAD']), before: first, at: '2026-09-25T00:00:00.000Z', files: [], cases: [] },
    });

    const motion = await motionOfLast(now, execution, [DISCOUNTS.id, CHECKS_OUT.id], process.cwd(), undefined, 'main');

    expect(motion.base).toMatchObject({ kind: 'before', at: first, leftOut: ['src/other.ts'] });
    expect(motion.moved?.regions).toEqual([]);
    expect(motionText(motion).join('\n')).toContain(`Against the run before it at ${first.slice(0, 12)}, no region moved.`);
  });

  it('refuses a base it cannot read, and says a pipeline needs none', async () => {
    const { root } = await checkout();
    await writeFile(join(root, 'total.test.ts'), 'it("discounts", () => { });\n');
    const { execution } = await recorded(index([0], []), index([0], []), 'HEAD');

    await expect(covering(parse(['--since', 'main', '--against', join(root, 'missing.bin'), '--execution', execution])))
      .rejects.toThrow(/needs no `--against`/);
  });

  it('refuses a base recorded at a commit this clone does not have, and names how to fetch it', async () => {
    const { root } = await checkout();
    git(root, ['checkout', '--quiet', '-b', 'change']);
    await writeFile(join(root, 'total.test.ts'), 'it("discounts", () => { /* no round */ });\n');
    const { against, execution } = await recorded(index([0, 1], [0]), index([0, 1], []), ABSENT);

    const refused = covering(parse(['--since', 'main', '--against', against, '--execution', execution]));

    await expect(refused).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining(`The base \`${against}\` was recorded at ${ABSENT}, which this clone does not have`),
    });
    await expect(refused).rejects.toThrow(`git fetch origin ${ABSENT}`);
    await expect(refused).rejects.toThrow('fetch-depth: 0');
  });

  it('refuses a base that names no commit', async () => {
    const { root } = await checkout();
    git(root, ['checkout', '--quiet', '-b', 'change']);
    await writeFile(join(root, 'total.test.ts'), 'it("discounts", () => { /* no round */ });\n');
    const { against, execution } = await recorded(index([0, 1], [0]), index([0, 1], []), undefined);

    await expect(covering(parse(['--since', 'main', '--against', against, '--execution', execution]))).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining(`The base \`${against}\` names no commit it was recorded at`),
    });
  });

  it('refuses cases it retired when the base\'s branch shares no history with this one', async () => {
    const { root, first } = await checkout();
    git(root, ['checkout', '--quiet', '--orphan', 'elsewhere']);
    git(root, ['commit', '--quiet', '-m', 'unrelated']);
    git(root, ['checkout', '--quiet', 'main']);
    const execution = join(await records(), 'coverage.bin');
    const now = index([0], [1]);
    await keep(execution, now, {
      before: index([0], [1]),
      last: { commit: first, before: first, at: '2026-09-25T00:00:00.000Z', files: [], cases: [] },
    });

    const refused = motionOfLast(now, execution, [DISCOUNTS.id, CHECKS_OUT.id], root, undefined, 'elsewhere');

    await expect(refused).rejects.toMatchObject({
      exitCode: 2,
      kind: 'undiffed',
      message: expect.stringContaining(`What the branch of \`elsewhere\` changed after ${first} could not be read, so the base is not compared:`),
    });
    await expect(refused).rejects.toThrow('fetch-depth: 0');
  });

  it('refuses `--against` without a diff', () => {
    expect(() => parse(['--file', 'src/total.ts', '--against', 'base.bin'])).toThrow(/takes `--since <ref>`/);
  });
});
