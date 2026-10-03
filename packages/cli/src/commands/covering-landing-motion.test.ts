import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import {
  decodeExecutionIndex,
  encodeAsSetExecutionIndex,
  encodeExecutionIndex,
  landCases,
  writeTestCoverage,
  type CommitRuns,
  type ExecutionBlock,
  type ExecutionIndex,
} from '@variance-authority/sense/test-selection';
import { motionOfRuns, motionText, runsWrote } from './covering-motion.js';

const DISCOUNTS = { id: 'total.test.ts > discounts', file: 'total.test.ts', name: 'discounts', stopped: false };

const CHECKS_OUT = { id: 'flow.test.tsx > checks out', file: 'flow.test.tsx', name: 'checks out', stopped: false };


function block(name: string, startLine: number, tests: readonly number[]): ExecutionBlock {
  return {
    kind: 'function', name, path: 'entry', startLine, endLine: startLine + 4, source: true,
    crossings: tests.map((test) => ({ test, distance: 0 })),
  };
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

/** The cases `discounts` ran at the base: both functions. */
const RETIRED: ExecutionIndex = {
  tests: [DISCOUNTS],
  modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 10, [0]), block('round', 30, [0])] }],
};

describe('the before layer of a landing', () => {
  /** `count` lines of a module, each a comment naming its line. */
  const lines = (count: number, word = 'line') => Array.from({ length: count }, (_, at) => `// ${word} ${at + 1}\n`).join('');
  const BASE_TEXT = lines(60);
  // Twenty lines written above the rest, so every region now stands where the one below it stood.
  const HEAD_TEXT = `${lines(20, 'added')}${BASE_TEXT}`;

  /** A checkout whose `src/total.ts` is `BASE_TEXT` at `base`, and `HEAD_TEXT` at `head`, which is checked out. */
  async function changed(): Promise<{ root: string; base: string; head: string }> {
    const { root } = await checkout();
    await writeFile(join(root, 'src/total.ts'), BASE_TEXT);
    git(root, ['commit', '--quiet', '-am', 'base']);
    const base = git(root, ['rev-parse', 'HEAD']);
    await writeFile(join(root, 'src/total.ts'), HEAD_TEXT);
    git(root, ['commit', '--quiet', '-am', 'change']);
    return { root, base, head: git(root, ['rev-parse', 'HEAD']) };
  }

  it('reads nothing moved for test files a change left alone, when two shards landed at its commit', async () => {
    // Each shard ran one untouched test file over the shifted module, and
    // each case still calls what it called at the base.
    const { root, base, head } = await changed();
    const dir = await records();
    const previous = {
      index: encodeAsSetExecutionIndex({
        tests: [DISCOUNTS, CHECKS_OUT],
        modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 10, [0]), block('round', 30, [1])] }],
      }),
      last: Buffer.from(JSON.stringify({ commit: base, at: '2026-09-25T00:00:00.000Z', files: [DISCOUNTS.file, CHECKS_OUT.file], cases: [] })),
    };
    const shard = async (name: string, test: typeof DISCOUNTS, called: string) => {
      const path = join(dir, name);
      await keep(path, {
        tests: [test],
        modules: [{ file: 'src/total.ts', blocks: [
          block('applyDiscount', 30, called === 'applyDiscount' ? [0] : []),
          block('round', 50, called === 'round' ? [0] : []),
        ] }],
      });
      const modules = [{ file: 'src/total.ts', sourceDigest: digestString(HEAD_TEXT) }];
      return { path, coverage: { commit: head, tests: [{ file: test.file, complete: true }], modules } };
    };
    const shards = [await shard('shard-1.bin', DISCOUNTS, 'applyDiscount'), await shard('shard-2.bin', CHECKS_OUT, 'round')];
    const execution = join(dir, 'coverage.bin');
    const { sections } = landCases(execution, previous, root, shards, new Map([['src/total.ts', digestString(BASE_TEXT)]]), base);
    await writeTestCoverage(execution, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, sections);

    const full = decodeExecutionIndex(sections.index!);
    const wrote = await runsWrote(execution, { commit: head, files: [DISCOUNTS.file, CHECKS_OUT.file] } as CommitRuns);
    const motion = await motionOfRuns(full, execution, wrote, root);

    expect(motion.base.at).toBe(base);
    expect(motion.moved?.regions).toEqual([]);
    expect(motion.moved?.testFiles).toEqual([]);
    expect(motion.unmeasured).toBeUndefined();
  });

  it('leaves a module the layer was cut from another text unmeasured, rather than read its regions as lost', async () => {
    const { root, base, head } = await changed();
    const execution = join(await records(), 'coverage.bin');
    const last = { commit: head, before: base, at: '2026-09-25T00:00:00.000Z', files: [DISCOUNTS.file], cases: [DISCOUNTS.id] };
    // At the base `discounts` called both regions; now no case calls either, twenty lines down.
    const full: ExecutionIndex = {
      tests: [DISCOUNTS],
      modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 30, []), block('round', 50, [])] }],
    };
    const read = async () => motionOfRuns(full, execution, await runsWrote(execution, { commit: head, files: [DISCOUNTS.file] } as CommitRuns), root);
    await keep(execution, full, { before: RETIRED, last: { ...last, beforeTexts: { 'src/total.ts': digestString(HEAD_TEXT) } } });

    const motion = await read();

    expect(motion.moved?.regions).toEqual([]);
    expect(motion.unmeasured).toEqual(['src/total.ts']);
    expect(motionText(motion)).toContain(
      `Not compared, the cases before were recorded over another text than ${base.slice(0, 12)} holds: src/total.ts.`,
    );

    // The same layer named at the base's text is compared, and loses both.
    await keep(execution, full, { before: RETIRED, last: { ...last, beforeTexts: { 'src/total.ts': digestString(BASE_TEXT) } } });
    const compared = await read();
    expect(compared.moved?.regions.map((region) => [region.name, region.motion])).toEqual([['applyDiscount', 'lost'], ['round', 'lost']]);
    expect(compared.unmeasured).toBeUndefined();

    // A layer that names texts, but none for this module, was cut from a text nobody knew.
    await keep(execution, full, { before: RETIRED, last: { ...last, beforeTexts: { 'src/other.ts': digestString(BASE_TEXT) } } });
    const unnamed = await read();
    expect(unnamed.moved?.regions).toEqual([]);
    expect(unnamed.unmeasured).toEqual(['src/total.ts']);
    expect(motionText(unnamed)).toContain(
      `Not compared, the cases before were recorded over another text than ${base.slice(0, 12)} holds: src/total.ts.`,
    );
  });
});
