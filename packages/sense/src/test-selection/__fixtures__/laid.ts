/**
 * A record as lines a person can read and a test can compare: each test with
 * its completeness, duration and preconditions, and each module with each of
 * its regions and the tests that crossed or loaded it. A field no line below
 * names is printed `name=value`, so a field the model gains is compared too.
 */

import { decodeTestCoverage, encodeTestCoverage } from '../format.js';
import { layCoverage } from '../format-layer.js';
import type { EditReadings } from '../edit-readings.js';
import type { CoverageBlock, TestCoverage } from '../index.js';

/** `current` laid over `previous` by the addon's lay, decoded: the runner's teardown, as a model. */
export function laidCoverage(
  previous: TestCoverage | undefined,
  current: TestCoverage,
  onDisk?: ReadonlyMap<string, string>,
  readings?: EditReadings,
): TestCoverage {
  return decodeTestCoverage(layCoverage(previous === undefined ? undefined : encodeTestCoverage(previous), current, onDisk, readings));
}

const BLOCK = new Set(['ordinal', 'kind', 'owner', 'digest', 'name', 'path', 'startLine', 'endLine', 'source', 'testFiles', 'loadedBy']);

function rest(row: object, named: ReadonlySet<string>): string {
  return Object.entries(row)
    .filter(([key]) => !named.has(key))
    .map(([key, value]) => ` ${key}=${JSON.stringify(value)}`)
    .join('');
}

function region(block: CoverageBlock): string {
  const lines = block.startLine === undefined ? 'unplaced' : `${block.startLine}-${block.endLine}`;
  const owner = block.owner === undefined ? '' : ` in ${block.owner}`;
  const source = block.source ? '' : ' no-source';
  const loaded = block.loadedBy === undefined ? '' : ` loaded ${block.loadedBy.join(' ')}`;
  return `  ${block.ordinal} ${block.kind}${owner} ${block.path} ${JSON.stringify(block.name)} ${block.digest} ${lines}${source} [${block.testFiles.join(' ')}]${loaded}${rest(block, BLOCK)}`;
}

/** `coverage` as lines: its commit, its tests, then each module and its regions. */
export function printed(coverage: TestCoverage): string[] {
  return [
    `commit ${coverage.commit ?? 'none'}`,
    ...coverage.tests.map((test) => {
      const duration = test.duration === undefined ? '' : ` ${test.duration}ms`;
      const preconditions = test.preconditions.map((input) => ` ${input.name}@${input.digest}`).join('');
      return `test ${test.file}${test.complete ? '' : ' incomplete'}${duration}${preconditions}`;
    }),
    ...coverage.modules.flatMap((module) => [
      `module ${module.file} ${module.sourceDigest}${module.instrumented ? '' : ' uninstrumented'}`,
      ...module.blocks.map(region),
    ]),
  ];
}
