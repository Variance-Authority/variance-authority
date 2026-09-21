import {
  changedLines,
  coveringChange,
  type CoveringChange,
  type CoveringTest,
  type ExecutionIndex,
} from '@variance-authority/sense/test-selection';
import { stringArg, type Tool } from './tool.js';

/**
 * Which named cases went where a change landed.
 *
 * `variance_source_tests` answers about a place the caller already has in mind.
 * This one is asked at review time, when the places are whatever the diff
 * touched and the reader does not yet know which of them matter — so it takes
 * the diff and reports every changed region, including the ones with nothing
 * behind them.
 *
 * The diff is an argument rather than a ref because a tool here is a pure
 * function from something already read: the host holds the index, the caller
 * holds the change, and nothing in this package runs `git`. An agent reviewing
 * a pull request has the patch in hand already.
 *
 * Two findings come out of it that no percentage can state. A changed region
 * **no case entered** is a hole in the evidence, and a changed region one case
 * alone entered is evidence standing on a single point. Both are named, both
 * are counted, and neither is called a failure — execution says where a case
 * went, never whether the trip was worth taking.
 */
export const changedTests: Tool<ExecutionIndex> = {
  name: 'variance_changed_tests',
  description:
    'Given a unified diff, report every changed source region with the named test cases that ' +
    'covered it, flagging regions no case covered and regions one case alone covered.',
  inputSchema: {
    type: 'object',
    properties: {
      diff: {
        type: 'string',
        description: 'A unified diff, in the coordinates the execution index spells files in.',
      },
    },
    required: ['diff'],
    additionalProperties: false,
  },
  run(index, input) {
    const changed = changedLines(stringArg(input, 'diff'));
    if (changed.size === 0) {
      return 'That diff names no changed file, so there is no region to ask about.';
    }
    return report(coveringChange(index, changed));
  },
};

function report(changed: readonly CoveringChange[]): string {
  const regions = changed.flatMap((file) => file.regions);
  const blind = regions.filter((region) => region.tests.length === 0).length;
  const alone = regions.filter((region) => region.tests.length === 1).length;

  const lines = [
    `${changed.length} changed file(s), ${regions.length} changed region(s): ${blind} that no ` +
      `case covered, ${alone} that one case alone covered.`,
  ];

  for (const file of changed) {
    lines.push('', file.file);
    if (file.cases.length > 0) {
      lines.push(`  a test file — ${file.cases.length} named case(s) declared here:`);
      lines.push(...file.cases.map((test) => `    ${test.name} [${test.id}]`));
    }
    if (!file.recorded) {
      if (file.cases.length === 0) {
        lines.push('  no row — the indexed run never loaded this file, which is not the same as nobody reaching it');
      }
      continue;
    }
    if (file.regions.length === 0) {
      lines.push('  indexed, and the change landed on no recorded region of it');
      continue;
    }
    for (const region of file.regions) {
      lines.push(`  ${extent(region)} — ${claim(region.tests.length)}${carried(region.passengers.length)}`);
      lines.push(...region.tests.map((test) => `    ${formatTest(test)}`));
    }
  }
  return lines.join('\n');
}

function extent(region: CoveringChange['regions'][number]): string {
  return `${region.startLine}-${region.endLine} ${region.kind}${
    region.name === '' ? '' : ` ${region.name}`
  }`;
}

function claim(count: number): string {
  if (count === 0) return 'no case covered this region';
  if (count === 1) return '1 case, and it is the only witness';
  return `${count} cases`;
}

function carried(count: number): string {
  return count === 0 ? '' : ` (+${count} carried in while the module evaluated)`;
}

function formatTest(test: CoveringTest): string {
  return `depth ${test.distance} — ${test.name} — ${test.file} [${test.id}]`;
}
