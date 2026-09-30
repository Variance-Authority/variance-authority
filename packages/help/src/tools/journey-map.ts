/**
 * `docs_journey_map` — from a file and a task, how the code there connects to
 * code elsewhere, drawn from the journeys of the tests the recording holds.
 *
 * The task is the filter and nothing else decides which tests are kept: a test
 * is kept when the file it is declared in, or its name, holds any of the words.
 * With no words every test that entered the file is kept. Nothing runs at
 * question time and no source is read; the recording owns what ran.
 */

// compass: variance-authority.report.agent-surface

import { checkoutListing, checkoutPath, journeyMaps } from '@variance-authority/sense';
import type { Tool } from '@variance-authority/mcp/tools';
import { formatJourneyMap } from './journey-map-format.js';
import { recordedOnce, refuseUnknownPath } from './unknown-path.js';

/** The words of a task, from a string or a list, lowercase-insensitive and without blanks. */
export function termsOf(input: Readonly<Record<string, unknown>>): readonly string[] {
  const said = input['query'];
  const listed: readonly unknown[] = typeof said === 'string' ? said.split(/\s+/) : Array.isArray(said) ? said : [];
  return listed.filter((word): word is string => typeof word === 'string').map((word) => word.trim()).filter((word) => word !== '');
}

/** Typed over nothing, like `docs_orient`: the checkout is the one the host names on the call. */
export const journeyMapTool: Tool<unknown> = {
  name: 'docs_journey_map',
  description:
    'The code around one file, drawn from what tests ran: how many recorded tests entered it, which the ' +
    'task kept, the paths through each of its functions, then the code beyond it that most kept tests ' +
    'entered, nearest first, and the code only some entered, told by their smallest test. Code most of the ' +
    'whole suite enters is counted, not drawn. `query` is the words of the task: a test is kept when the file it is declared ' +
    'in or its name holds any of them; with none, every test that entered the file is kept. Reads the ' +
    'recording a test run with test selection published; runs nothing and reads no source.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'The path of the one file to map around, from the root of the checkout or of the file system.' },
      query: {
        type: 'string',
        description: 'Optional. Words of the task; keeps the tests whose file or name holds any of them.',
      },
    },
    required: ['file'],
    additionalProperties: false,
  },

  run: (_subject, input, invocation) => {
    const root = invocation?.root;
    if (root === undefined) {
      throw new Error('`journey-map` reads what a checkout published, and this host named no checkout to read');
    }
    const file = typeof input['file'] === 'string' ? input['file'].trim() : '';
    if (file === '') throw new Error('`journey-map` takes `--file`, the path of the file to map around');
    const asked = checkoutPath(root, file);
    if ('outside' in asked) throw new Error(asked.outside);
    // Git is asked about the path once, and the recording's readers and the typo check all read that answer.
    const listing = checkoutListing(root, asked.path);
    const terms = termsOf(input);
    const suites = journeyMaps(root, asked.path, terms, listing);
    if (suites.length === 0) throw new Error(`the recording under ${root} holds no suite to read`);
    const answers: string[] = [];
    const refused: string[] = [];
    for (const { suite, map } of suites) {
      const of = suite === undefined ? '' : `suite ${suite}: `;
      if (map.notRecorded === undefined || map.notRecorded === null) answers.push(`${of}${formatJourneyMap(map, terms)}`);
      else refused.push(`${of}${map.notRecorded}`);
    }
    if (answers.length === 0) {
      // A path neither the checkout nor the recording's commit holds is a typo, not a file no test ran; the
      // map itself answers a directory, an ignored file and a file deleted since the recording.
      const somewhere = !('unread' in listing) && (listing.directory || listing.ignored);
      if (!somewhere && !suites.some(({ known }) => known?.existed === true)) refuseUnknownPath(root, asked.path, recordedOnce(root), listing);
      throw new Error(refused.join('\n'));
    }
    return [...answers, ...refused].join('\n\n');
  },
};
