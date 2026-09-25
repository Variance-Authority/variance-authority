// compass: variance-authority/runtime/attention
/**
 * One test read apart from the rest of the suite.
 *
 * Read inside the whole suite, a test is read with a bias: other cases cover
 * the lines it misses, so its gaps look walked. `--cases` answers from the
 * chosen cases and nothing else. It does not run anything: running a test alone
 * is the runner's job, and the index already holds what each case entered.
 * `last` is the run that wrote the index last, which is the run you just made.
 * A test file is every case of that file.
 */

import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  caseLayerFiles,
  type ExecutionIndex,
  type LastCaseRun,
} from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';

/** Which cases an answer was read from, when it was not the whole suite. */
export interface CoveringScope {
  /** What was asked: `last`, or the test file as the index spells it. */
  readonly cases: string;
  /** The ids of the cases the answer was read from. */
  readonly tests: readonly string[];
  /** With `last`: the commit that run was made at, when it said. */
  readonly at?: string;
}

/** The index cut to the cases `--cases` names, and a statement of which they were. */
export async function scopeCases(
  index: ExecutionIndex,
  from: string,
  cases: string,
  root: string,
): Promise<{ readonly index: ExecutionIndex; readonly scope: CoveringScope }> {
  if (cases === 'last') {
    const last = await lastRun(from);
    return {
      index: keepCases(index, new Set(last.cases)),
      scope: { cases, tests: last.cases, ...(last.commit === undefined ? {} : { at: last.commit }) },
    };
  }
  const file = testFile(index, cases, root);
  const tests = index.tests.filter((test) => test.file === file).map((test) => test.id);
  return { index: keepCases(index, new Set(tests)), scope: { cases: file, tests } };
}

/**
 * The index with every other case taken out, and every crossing renumbered.
 *
 * A region stays when no chosen case entered it: *no case you chose entered
 * this* is the answer, and a region missing from the answer would say the run
 * never loaded the module.
 */
export function keepCases(index: ExecutionIndex, ids: ReadonlySet<string>): ExecutionIndex {
  const renumber = new Int32Array(index.tests.length).fill(-1);
  let kept = 0;
  const tests = index.tests.filter((test, at) => {
    if (!ids.has(test.id)) return false;
    renumber[at] = kept;
    kept += 1;
    return true;
  });
  return {
    tests,
    modules: index.modules.map((module) => ({
      ...module,
      blocks: module.blocks.map((block) => ({
        ...block,
        crossings: block.crossings
          .filter((crossing) => renumber[crossing.test]! >= 0)
          .map((crossing) => ({ ...crossing, test: renumber[crossing.test]! })),
      })),
    })),
  };
}

async function lastRun(from: string): Promise<LastCaseRun> {
  const file = caseLayerFiles(from).last;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as LastCaseRun;
  } catch (error) {
    throw new OperatorError(
      `\`--cases last\` reads the run that wrote the index last from \`${file}\`, and it could not be read (${
        error instanceof Error ? error.message : String(error)
      }). A run records it beside the index; run a test file and ask again.`,
    );
  }
}

/** The test file as the index spells it, whether it was given that way or from here. */
function testFile(index: ExecutionIndex, given: string, root: string): string {
  const files = new Set(index.tests.map((test) => test.file));
  if (files.has(given)) return given;
  const fromRoot = relative(root, resolve(given));
  if (files.has(fromRoot)) return fromRoot;
  const tail = given.slice(given.lastIndexOf('/') + 1);
  const near = [...files].filter((file) => file.endsWith(`/${tail}`) || file === tail).sort().slice(0, 3);
  throw new OperatorError(
    `\`--cases ${given}\` names no test file the index holds a case of. ${
      near.length === 0
        ? `Nothing recorded ends in \`${tail}\`.`
        : `The record spells it ${near.map((file) => `\`${file}\``).join(', ')}.`
    }`,
  );
}
