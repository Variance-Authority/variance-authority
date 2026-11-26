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
import { ASKED_TEST_INPUT, askedTest, suitesAnswer } from './asked-test.js';
import { RECORDING } from './slowest-format.js';
import { formatTestComposition } from './test-composition-format.js';

/** Typed over nothing, like `docs_journey_map`: the checkout is the one the host names on the call. */
export const testCompositionTool: Tool<unknown> = {
  name: 'docs_test_composition',
  description:
    'What one recorded test is made of: the smaller tests whose code sits inside its own (its ' +
    'pieces), the larger tests holding it (its wholes), and the code no piece ran, which a test ' +
    'nearer that code would cover more cheaply. Use docs_test_claims to hold a test against its name ' +
    `and steps. ${RECORDING}; reads no source.`,
  inputSchema: ASKED_TEST_INPUT,

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
