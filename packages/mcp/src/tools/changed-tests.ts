import {
  changedLines,
  coveringChange,
  formatCoveringChange,
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
 * **no case covered** is a hole in the evidence, and a changed region one case
 * alone covered is evidence standing on a single point. Both are named, both
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
    // TODO: pass `{ relations }` so a case whose file mocked the changed module is not
    // listed under it, as `variance covering --since` does; needs the host to hold the file graph.
    return formatCoveringChange(coveringChange(index, changed));
  },
};
