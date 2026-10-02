/**
 * The trees Vitest's workers write when the seam's case runner finishes their
 * files, read back by the fold of a run no reporter folded.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFinished } from './finished-files.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const made = await mkdtemp(resolve(tmpdir(), 'variance-authority-finished-'));
  temporary.push(made);
  return made;
}

/** One worker's tree, in the shape and under the name the case runner writes it. */
async function workerWrote(finished: string, tree: readonly object[]): Promise<void> {
  await writeFile(resolve(finished, `${process.pid}-${randomUUID()}.json`), JSON.stringify(tree));
}

/** A file one worker ran: one case, passed or failed, timed as the runner timed it. */
function ran(at: number) {
  const state = at % 2 === 0 ? 'pass' : 'fail';
  return [{
    filepath: '/repo/test/price.test.ts',
    runnerSkipped: false,
    mode: 'run',
    result: { state, duration: 0.1 * (at + 1) },
    tasks: [{ name: 'prices a line', id: `case-${at}`, mode: 'run', result: { state, duration: 0.1 * (at + 1) } }],
  }];
}

describe('the files the case runners said they finished', () => {
  it('is nothing where no case runner wrote a tree', async () => {
    expect(await readFinished(resolve(await directory(), 'never-written'))).toEqual([]);
  });

  it('is every file of every tree, as the reporter would have read it', async () => {
    const finished = await directory();
    await workerWrote(finished, ran(0));

    expect(await readFinished(finished)).toEqual([{
      filepath: '/repo/test/price.test.ts',
      complete: true,
      duration: 0.1,
      cases: [{ name: 'prices a line', id: 'case-0', duration: 0.1 }],
    }]);
  });

  it('is the same whichever worker finished first', async () => {
    // Six workers ran the same file, and the fold sums what they timed: a read
    // in any order but what they wrote agrees with itself once in 720 runs.
    const trees = Array.from({ length: 6 }, (_, at) => ran(at));
    const forwards = await directory();
    for (const tree of trees) await workerWrote(forwards, tree);
    const backwards = await directory();
    for (const tree of [...trees].reverse()) await workerWrote(backwards, tree);

    expect(JSON.stringify(await readFinished(backwards))).toBe(JSON.stringify(await readFinished(forwards)));
  });
});
