import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrument, type Block } from '../instrument/index.js';
import { coverageBlock } from './coverage-rows.js';
import {
  journeysApart,
  mergeCoverage,
  narrowByExecution,
  writeTestCoverage,
  type CoverageBlock,
  type TestCoverage,
} from './index.js';

/**
 * The historical-absence safety contract as one flow.
 *
 * Yesterday's record cannot contain a decision written today. Selection must
 * therefore ask who reached the old junction, not who entered the new outcome;
 * after those tests run, divergence must read their current crossings rather
 * than the upper bound that selected them.
 */

const BASELINE = '1111111111111111111111111111111111111111';
const CURRENT = '2222222222222222222222222222222222222222';
const PICK = 'src/pick.ts';
const ONE = 'test/one.test.ts';
const ZERO = 'test/zero.test.ts';
const OTHER = 'test/other.test.ts';
const OBSERVERS = [ONE, ZERO];

const BEFORE = `export function pick(n) {
  if (n === 1) {
    return 'one';
  }
  return 'other';
}
`;

const DECISION_BEFORE = `export function pick(n) {
  if (n === 0) {
    return 'zero';
  }
  if (n === 1) {
    return 'one';
  }
  return 'other';
}
`;

const DECISION_INSIDE = `export function pick(n) {
  if (n === 1) {
    if (n > 1) {
      return 'impossible';
    }
    return 'one';
  }
  return 'other';
}
`;

const insertedBefore = `diff --git a/${PICK} b/${PICK}
--- a/${PICK}
+++ b/${PICK}
@@ -1,0 +2,3 @@
+  if (n === 0) {
+    return 'zero';
+  }
`;

const editedInside = `diff --git a/${PICK} b/${PICK}
--- a/${PICK}
+++ b/${PICK}
@@ -4,1 +4,1 @@
-      return 'impossible';
+      return 'still impossible';
`;

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function row(source: string, block: Block): CoverageBlock {
  return coverageBlock(source, block);
}

function recording(
  source: string,
  commit: string,
  tests: readonly string[],
  entered: (block: CoverageBlock) => readonly string[],
): TestCoverage {
  const cut = instrument(source, PICK, PICK, { mode: 'presence' });
  if (cut === undefined) throw new Error('the proof source did not instrument');
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit,
    tests: tests.map((file) => ({
      file,
      complete: true,
      preconditions: [{ name: file, digest: `source:${file}` }],
    })),
    modules: [{
      file: PICK,
      sourceDigest: cut.sourceDigest,
      instrumented: true,
      blocks: cut.blocks.map((block) => {
        const placed = row(source, block);
        return { ...placed, testFiles: [...entered(placed)] };
      }),
    }],
  };
}

function before(): TestCoverage {
  return recording(BEFORE, BASELINE, OBSERVERS, (block) => {
    if (block.path === 'module' || block.path === 'entry') return OBSERVERS;
    if (block.path === 'if#0/then') return [ONE];
    return [ZERO];
  });
}

function after(): TestCoverage {
  return recording(DECISION_BEFORE, CURRENT, OBSERVERS, (block) => {
    if (block.path === 'module' || block.path === 'entry') return OBSERVERS;
    if (block.path === 'if#0/then') return [ZERO];
    if (block.path === 'if#0/after' || block.path === 'if#1/then') return [ONE];
    return [];
  });
}

function unrelated(): TestCoverage {
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit: CURRENT,
    tests: [{ file: OTHER, complete: true, preconditions: [{ name: OTHER, digest: `source:${OTHER}` }] }],
    modules: [],
  };
}

async function snapshot(coverage: TestCoverage): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'variance-new-decision-'));
  temporary.push(directory);
  const file = join(directory, 'coverage.bin');
  await writeTestCoverage(file, coverage);
  return file;
}

describe('a decision written after the recorded journeys', () => {
  it('selects the junction observers, then reports the paths their current run took', async () => {
    const previous = before();
    const selected = await narrowByExecution(await snapshot(previous), insertedBefore, {
      sourceAt: (file, commit) => file === PICK && commit === BASELINE ? BEFORE : undefined,
    });

    expect(selected).toMatchObject({
      whole: OBSERVERS,
      entered: OBSERVERS,
      unread: [],
      stale: [],
    });
    for (const observer of OBSERVERS) {
      expect(selected.because.find(({ test }) => test === observer)?.via).toContainEqual(
        expect.objectContaining({ kind: 'region', file: PICK, startLine: 1, endLine: 6 }),
      );
    }

    const current = mergeCoverage(previous, after());
    const [divergence] = await journeysApart(await snapshot(current), { observers: OBSERVERS });

    expect(divergence?.parted).toContainEqual(expect.objectContaining({
      kind: 'branch',
      name: 'pick',
      startLine: 2,
      entered: [ZERO],
      missed: [ONE],
    }));
  });

  it('answers a born region from the nearest recorded junction, never from an invented empty', async () => {
    const carried = mergeCoverage(before(), unrelated(), new Map([[PICK, DECISION_INSIDE]]));
    const selected = await narrowByExecution(await snapshot(carried), editedInside, {
      sourceAt: (file, commit) => file === PICK && commit === CURRENT ? DECISION_INSIDE : undefined,
    });

    expect(selected).toMatchObject({
      whole: [ONE, OTHER, ZERO],
      entered: [ONE],
      unread: [],
      stale: [],
    });
    expect(selected.because).toEqual([
      expect.objectContaining({
        test: ONE,
        via: [expect.objectContaining({ kind: 'region', file: PICK, startLine: 3, endLine: 5 })],
      }),
    ]);
  });
});
