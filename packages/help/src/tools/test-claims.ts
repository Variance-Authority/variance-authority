/**
 * `docs_test_claims` — one test held against what it says: its claims, the
 * functions it ran, what it adds to the suite, and what it passed by.
 *
 * Nothing runs at question time and no source is read. The recording owns
 * what each test entered, the composition owns what the suite already covers,
 * and the Eyes journal the same run kept owns the steps and assertions.
 */

// compass: variance-authority.report.agent-surface

import { testCompositions, testsRan } from '@variance-authority/sense';
import type { Tool } from '@variance-authority/mcp/tools';
import { recordedSteps } from '@variance-authority/mcp/recorded-steps';
import { ASKED_TEST_INPUT, askedTest, suitesAnswer } from './asked-test.js';
import { formatTestClaims } from './test-claims-format.js';

/** Typed over nothing, like `docs_test_composition`: the checkout is the one the host names on the call. */
export const testClaimsTool: Tool<unknown> = {
  name: 'docs_test_claims',
  description:
    'One test held against what it says, from what the recorded tests ran: its claims — its name, and the ' +
    'steps and assertions it made when the run kept an Eyes journal; the functions it ran, structure ' +
    'counted apart; what it adds — the tests that ran the same regions, structure aside, its pieces and ' +
    'wholes, and the regions only it enters; and the regions of the functions it entered that it did not ' +
    'take — a branch, a case, a loop body, a handler — each with whether another test takes it. `file` is the test file; `name` chooses one of its tests, exactly ' +
    'or by a word of its name. Reads the recording a test run with test selection published; runs nothing ' +
    'and reads no source.',
  inputSchema: ASKED_TEST_INPUT,

  run: (_subject, input, invocation) => {
    const { root, file, name } = askedTest('test-claims', input, invocation);
    const ran = testsRan(root, file, name);
    return suitesAnswer(root, testCompositions(root, file, name).map(({ suite, composition }) => {
      const named = suite === undefined ? {} : { suite };
      // A suite is named once in a checkout, and the one suite of a checkout that names none is unnamed in both.
      const suiteRan = ran.find((read) => read.suite === suite);
      const test = suiteRan?.ran.test ?? undefined;
      const notRecorded = composition.notRecorded ?? suiteRan?.ran.notRecorded ?? undefined;
      if (notRecorded !== undefined) return { ...named, refused: notRecorded };
      if (suiteRan === undefined || test === undefined) return { ...named, refused: 'the recording names no test to read' };
      return { ...named, answer: formatTestClaims(composition, suiteRan.ran, recordedSteps(suiteRan.recording, test.id)) };
    }));
  },
};
