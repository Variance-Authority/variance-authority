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
    const root = invocation?.root;
    if (root === undefined) {
      throw new Error('`test-composition` reads what a checkout published, and this host named no checkout to read');
    }
    const file = typeof input['file'] === 'string' ? input['file'].trim() : '';
    if (file === '') throw new Error('`test-composition` takes `--file`, the test file that declares the test');
    const name = typeof input['name'] === 'string' && input['name'].trim() !== '' ? input['name'].trim() : undefined;
    const suites = testCompositions(root, file, name);
    if (suites.length === 0) throw new Error(`the recording under ${root} holds no suite to read`);
    const answers: string[] = [];
    const refused: string[] = [];
    for (const { suite, composition } of suites) {
      const of = suite === undefined ? '' : `suite ${suite}: `;
      if (composition.notRecorded === undefined || composition.notRecorded === null) answers.push(`${of}${formatTestComposition(composition)}`);
      else refused.push(`${of}${composition.notRecorded}`);
    }
    if (answers.length === 0) throw new Error(refused.join('\n'));
    return [...answers, ...refused].join('\n\n');
  },
};
