import { adjudicateRun, describeAdjudication, type Claim } from '@variance-authority/report';
import type { Tool } from './tool.js';

/**
 * `variance_adjudicate` — the run read back against what the agent said it did.
 *
 * Every other tool here answers about the run. This one answers about the
 * *agent*, and it is the only tool in the set that takes evidence in rather than
 * only handing it out: the declaration is something no report can contain,
 * because the report was written by a process that never knew what the edit was
 * for.
 *
 * What it buys is the arm nothing else in this category ships. `variance_changes`
 * can tell an agent that `Button` moved in twelve subjects; it cannot tell it
 * that `Card` — which the agent believes it just edited — did not move at all.
 * That is not a diff finding, it is the *absence* of one, and an absence is only
 * a finding once something declared it should have been there.
 *
 * The tool deliberately refuses to help an agent declare after the fact. It takes
 * claims as an argument and derives none, so an agent that calls
 * `variance_changes` first and then submits the answer back as its intent is
 * scoring the run against itself — visibly, because the transcript shows the
 * order. Nothing here can prevent that; what it can do is never do it *for* the
 * agent.
 */
export const adjudicate: Tool = {
  name: 'variance_adjudicate',
  description:
    'Read this run back against what you meant to change. Declare each intended change as a ' +
    'claim — the component or shape, why, and at most how many subjects it should reach — and ' +
    'get three answers: what you declared and delivered, what moved that you did not declare, ' +
    'and what you declared that never happened. The last one is the point: it is how you find ' +
    'out an edit did not take (wrong file, dead branch, an overridden rule, a stale build), ' +
    'which no screenshot comparison can tell you. Declare before you read the diff; claims ' +
    'copied out of `variance_changes` score the run against itself.',
  inputSchema: {
    type: 'object',
    properties: {
      claims: {
        type: 'array',
        minItems: 1,
        description: 'What you intended to change. One entry per intended change.',
        items: {
          type: 'object',
          properties: {
            root: {
              type: 'string',
              description:
                'What the change is about: `component:Button`, `shape:<fingerprint>`, or a ' +
                'bare name read as a component. Matched exactly, never by prefix.',
            },
            reason: {
              type: 'string',
              description: 'Why you changed it, in your own words. Carried into the answer.',
            },
            maxSubjects: {
              type: 'integer',
              minimum: 1,
              description:
                'At most how many subjects this change should reach. Optional, and the most ' +
                'useful field here: exceeding it is not a failure, it is the blast radius ' +
                'you did not expect.',
            },
          },
          required: ['root', 'reason'],
          additionalProperties: true,
        },
      },
    },
    required: ['claims'],
    additionalProperties: false,
  },

  run(report, input) {
    const { claims, unchecked } = parseClaims(input['claims']);

    if (claims.length === 0) {
      // An empty declaration is not a clean run, and answering it as one would
      // report "nothing you meant to do is missing" to an agent that declared
      // nothing. Said plainly instead, because the fix is one field away.
      return (
        'No claims were supplied, so there is nothing to adjudicate. This tool answers what ' +
        'your run did against what you said you were doing; with no declaration it can only ' +
        'repeat `variance_changes`. Declare the edits you made, then ask again.'
      );
    }

    return describeAdjudication(
      adjudicateRun(report, claims, unchecked.length > 0 ? { unchecked } : {}),
    );
  },
};

/**
 * Narrow whatever JSON a model produced, and keep what could not be checked.
 *
 * A declared field this resolution cannot verify is carried out rather than
 * dropped. An agent that declares `bands: ['paint']` and is answered `delivered`
 * has been told its band claim held; a run report keeps no band per change, so
 * nothing looked, and the answer has to say which of the two it is.
 */
function parseClaims(value: unknown): { claims: Claim[]; unchecked: string[] } {
  if (!Array.isArray(value)) {
    throw new Error('`claims` is required and must be an array of {root, reason, maxSubjects?}');
  }

  const claims: Claim[] = [];
  const unchecked = new Set<string>();

  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`claims[${index}] must be an object with \`root\` and \`reason\``);
    }

    const record = entry as Record<string, unknown>;
    const root = record['root'];
    const reason = record['reason'];

    if (typeof root !== 'string' || root === '') {
      throw new Error(`claims[${index}].root is required and must be a non-empty string`);
    }
    if (typeof reason !== 'string' || reason === '') {
      throw new Error(`claims[${index}].reason is required and must be a non-empty string`);
    }

    const maxSubjects = record['maxSubjects'];
    if (maxSubjects !== undefined && (typeof maxSubjects !== 'number' || maxSubjects < 1)) {
      throw new Error(`claims[${index}].maxSubjects must be a positive integer when present`);
    }

    for (const key of Object.keys(record)) {
      if (key !== 'root' && key !== 'reason' && key !== 'maxSubjects') unchecked.add(key);
    }

    claims.push(
      maxSubjects === undefined
        ? { root, reason }
        : { root, reason, maxSubjects: Math.trunc(maxSubjects) },
    );
  }

  return { claims, unchecked: [...unchecked] };
}
