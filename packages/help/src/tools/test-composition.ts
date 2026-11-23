/**
 * `docs_test_composition` — what one test is made of, read off the recording:
 * the smaller tests whose journeys sit inside its own, the larger ones holding
 * it, and the regions none of its pieces entered.
 *
 * Nothing runs at question time and no source is read; the recording owns what
 * each test entered, and the answer is a set of counts and places over it.
 */

// compass: variance-authority.report.agent-surface

import { testCompositions } from '@variance-authority/sense';
import type { Tool } from '@variance-authority/mcp/tools';
import { askedTest, suitesAnswer } from './asked-test.js';
import { formatTestComposition } from './test-composition-format.js';

/** Typed over nothing, like `docs_journey_map`: the checkout is the one the host names on the call. */
export const testCompositionTool: Tool<unknown> = {
  name: 'docs_test_composition',
  description:
    'What one test is made of, from what the recorded tests ran: the smaller tests whose regions sit ' +
    'inside its own (its pieces), the larger tests holding it (its wholes), and the regions no piece ' +
    'entered, split into its own layer — modules no piece entered — and paths through a piece\'s modules ' +
    'only it takes, which a test nearer that code would reach more cheaply. Regions more than half the ' +
    'suite entered are structure and counted apart. `file` is the test file; `name` chooses one of its ' +
    'tests, exactly or by a word of its name. Reads the recording a test run with test selection ' +
    'published; runs nothing and reads no source.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'The test file that declares the test, from the root of the checkout or of the file system.' },
      name: { type: 'string', description: 'Optional when the file declares one recorded test. The test\'s name, or a word of it.' },
    },
    required: ['file'],
    additionalProperties: false,
  },

  run: (_subject, input, invocation) => {
    const { root, file, name } = askedTest('test-composition', input, invocation);
    return suitesAnswer(root, testCompositions(root, file, name).map(({ suite, composition }) => ({
      ...(suite === undefined ? {} : { suite }),
      ...(composition.notRecorded === undefined || composition.notRecorded === null
        ? { answer: formatTestComposition(composition) }
        : { refused: composition.notRecorded }),
    })));
  },
};
