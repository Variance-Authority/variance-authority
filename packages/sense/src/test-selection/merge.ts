/**
 * Merging is where two runs become one index, and where evidence is retired.
 *
 * Split out of the Vitest seam because it was never that seam's: a Storybook
 * build and a Playwright suite merge into the same index by the same rules, and
 * a journal transport reaching them through the runner integration would be
 * importing a runner it does not have.
 */

import { readFile } from 'node:fs/promises';
import { decodeTestCoverage } from './format.js';
import type { CoverageBlock, CoverageModule, CoverageTest, TestCoverage } from './index.js';
import { codeUnitOrder } from './instrumented-modules.js';

/**
 * Merge independent runs and shards without transferring evidence across generations.
 *
 * The result is positioned where `current` is. A merge whose two sides name
 * different commits is a local layer over a baseline — the ordinary shape, and
 * the reason nothing is refused here: a run adds what it saw to what was already
 * known, and the index then stands at the commit that run was made at. Whether
 * an individual block's crossings survive that is decided per block by
 * {@link reusableBlock}, which compares the region's own digest and is a finer
 * question than the commit.
 */
export function mergeCoverage(
  previous: TestCoverage | undefined,
  current: TestCoverage,
): TestCoverage {
  if (previous === undefined) return current;
  if (previous.instrumentation !== current.instrumentation) return current;

  const currentTests = new Map(current.tests.map((test) => [test.file, test]));
  const previousTests = new Map(previous.tests.map((test) => [test.file, test]));
  const retired = new Set(current.tests.flatMap((test) => {
    const before = previousTests.get(test.file);
    return test.complete || (before !== undefined && !samePreconditions(before, test))
      ? [test.file]
      : [];
  }));
  const tests = [
    ...previous.tests.filter((test) => !currentTests.has(test.file)),
    ...current.tests,
  ].sort((left, right) => codeUnitOrder(left.file, right.file));
  const currentFiles = new Map(current.modules.map((module) => [module.file, module]));
  const modules = current.modules.map((module): CoverageModule => {
    const old = previous.modules.find((candidate) => candidate.file === module.file);
    return {
      file: module.file,
      sourceDigest: module.sourceDigest,
      instrumented: module.instrumented,
      blocks: module.blocks.map((block) => {
        const before = old?.blocks.find(
          (candidate) => candidate.name === block.name && candidate.path === block.path,
        );
        const reusable = module.instrumented && old?.instrumented === true &&
          before !== undefined &&
          reusableBlock(block, before, module, old);
        return {
          ...block,
          testFiles: [...new Set([
            ...(reusable ? before.testFiles.filter((test) => !retired.has(test)) : []),
            ...block.testFiles,
          ])].sort(codeUnitOrder),
        };
      }),
    };
  });
  for (const module of previous.modules) {
    if (!currentFiles.has(module.file)) {
      modules.push({
        ...module,
        blocks: module.blocks.map((block) => ({
          ...block,
          testFiles: block.testFiles.filter((test) => !retired.has(test)),
        })),
      });
    }
  }
  modules.sort((left, right) => codeUnitOrder(left.file, right.file));
  return {
    version: 3,
    instrumentation: current.instrumentation,
    ...(current.commit === undefined ? {} : { commit: current.commit }),
    tests,
    modules,
  };
}

/**
 * The index a merge is about to write over, or nothing to merge with.
 *
 * Undecodable counts as nothing. This is the read half of a read-modify-write,
 * and the only two things it can do with a file it cannot parse are refuse the
 * recording or replace it. Refusing means a format change, a truncated write or
 * a half-copied cache file stops every later run from recording anything until
 * somebody deletes it by hand — and it does so *after* taking the index lock,
 * from inside a runner's teardown, where the sentence is easiest to miss.
 * Replacing costs this machine the evidence it could no longer read, which the
 * next full run restores, and which in the meantime widens selection rather than
 * narrowing it.
 *
 * Readers ask the opposite way round. A caller that is about to *exclude* tests
 * gets the decode error, because there the same unreadable file would silently
 * become an empty answer.
 */
export async function existingCoverage(file: string): Promise<TestCoverage | undefined> {
  try {
    return decodeTestCoverage(await readFile(file));
  } catch {
    return undefined;
  }
}

function samePreconditions(left: CoverageTest, right: CoverageTest): boolean {
  const keys = (test: CoverageTest): ReadonlySet<string> =>
    new Set(test.preconditions.map((input) => `${input.name}\0${input.digest}`));
  const leftKeys = keys(left);
  const rightKeys = keys(right);
  return leftKeys.size === rightKeys.size && [...leftKeys].every((key) => rightKeys.has(key));
}

function reusableBlock(
  current: CoverageBlock,
  previous: CoverageBlock,
  currentModule: CoverageModule,
  previousModule: CoverageModule,
): boolean {
  if (current.digest !== previous.digest || current.kind !== previous.kind) return false;
  if (current.owner === undefined || previous.owner === undefined) {
    return current.owner === previous.owner;
  }
  const currentOwner = currentModule.blocks.find((block) => block.ordinal === current.owner);
  const previousOwner = previousModule.blocks.find((block) => block.ordinal === previous.owner);
  if (currentOwner === undefined || previousOwner === undefined) return false;
  if (currentOwner.name !== previousOwner.name || currentOwner.path !== previousOwner.path) return false;
  return reusableBlock(currentOwner, previousOwner, currentModule, previousModule);
}
