import type { Tool } from './tool.js';

/**
 * `variance_decisions` — what reviewers decided on the review surface.
 *
 * Every approval and every rejection a deployment recorded, newest first, with
 * who made it, when, and the note they left. A reversal is not folded away: a
 * subject rejected and then approved is two rows, because the rejection's note
 * is often the only place the reason for the approval is written. The row a
 * later decision on the same build and subject replaced is marked, so the
 * decision that stands is the first one an agent reads for each pair.
 *
 * Read, never written. The history is fetched with the share token, which the
 * deployment admits to what review settled and refuses at every route that
 * decides, so nothing an agent passes here can approve or reject a subject.
 *
 * Its own subject rather than a report, because a decision is a fact about a
 * deployment and not about any run: the host fetches the history this call
 * asked for and hands it over as a value, like the mainline's costs.
 */

export type ReviewDecision = 'approved' | 'rejected';

/** One decision, on one subject of one build. */
export interface ReviewDecisionEntry {
  readonly build: string;
  readonly subject: string;
  readonly decision: ReviewDecision;
  readonly by: string;
  readonly at: string;
  readonly note?: string;
}

/** The decisions a host read for one call, and where it read them. */
export interface ReviewSubject {
  /** The deployment the history was read from, as a reader should be told it. */
  readonly from: string;
  /** Newest first, as the deployment answered them. */
  readonly decisions: readonly ReviewDecisionEntry[];
}

/** What one call asked for, after its input was read. */
export interface DecisionsQuery {
  readonly subject?: string;
  readonly build?: string;
  readonly limit: number;
}

const DEFAULT_LIMIT = 20;

/**
 * The call's input, read once: the host fetches the window this names, and the
 * answer narrows to the same window, so the two cannot disagree about what was
 * asked.
 *
 * A call names a subject or a build. The newest decisions of a whole project are
 * a sample under a heading that reads as an answer, so a call that names
 * neither is refused, with what to pass.
 */
export function decisionsQuery(input: Readonly<Record<string, unknown>>): DecisionsQuery {
  const subject = textOf(input, 'subject');
  const build = textOf(input, 'build');
  if (subject === undefined && build === undefined) {
    throw new Error(
      '`variance_decisions` needs a `subject` or a `build`: the subject id whose decisions you want, or the build they were made on',
    );
  }
  const limit = input['limit'];
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) {
    throw new Error('`limit` must be a whole number of at least 1');
  }
  return {
    ...(subject === undefined ? {} : { subject }),
    ...(build === undefined ? {} : { build }),
    limit: (limit as number | undefined) ?? DEFAULT_LIMIT,
  };
}

export const decisions: Tool<ReviewSubject> = {
  name: 'variance_decisions',
  description:
    'What reviewers decided on the review surface: every approval and rejection, newest first, with who ' +
    'made it, when, and their note. A decision a later one replaced is marked, so the first row for a ' +
    'subject and build is the one that stands. Read with the share token, which reads and never decides — ' +
    'nothing here approves or rejects. Ask this before proposing a baseline change for a subject a ' +
    'reviewer already decided on, or to learn why a baseline was approved.',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'The decisions on this subject id. Pass this, `build`, or both.' },
      build: { type: 'string', description: 'The decisions on this build id. Pass this, `subject`, or both.' },
      limit: {
        type: 'integer',
        minimum: 1,
        description: `Optional. How many decisions to list, newest first; ${String(DEFAULT_LIMIT)} by default.`,
      },
    },
    additionalProperties: false,
  },

  run(subject, input) {
    const query = decisionsQuery(input);
    const read = subject.decisions
      .filter((entry) => (query.subject === undefined || entry.subject === query.subject) &&
        (query.build === undefined || entry.build === query.build))
      .slice(0, query.limit);
    const on = [
      ...(query.subject === undefined ? [] : [` on ${query.subject}`]),
      ...(query.build === undefined ? [] : [` in build ${query.build}`]),
    ].join('');
    if (read.length === 0) return `${subject.from} records no decision${on}.`;

    const seen = new Set<string>();
    const lines = [`${subject.from}: ${count(read.length, 'decision')}${on}, newest first.`, ''];
    for (const entry of read) {
      const pair = `${entry.build}\u0000${entry.subject}`;
      const replaced = seen.has(pair);
      seen.add(pair);
      lines.push(
        `  ${entry.at}  ${entry.decision}  ${entry.subject}  ${entry.build}  ${entry.by}` +
          (entry.note === undefined ? '' : `  ${JSON.stringify(entry.note)}`) +
          (replaced ? '  (replaced)' : ''),
      );
    }
    if (read.length === query.limit) {
      lines.push(`  the newest ${String(query.limit)} are listed and the history may hold more; \`limit\` reads further back`);
    }
    return lines.join('\n');
  },
};

function textOf(input: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') throw new Error(`\`${name}\` must be a non-empty string`);
  return value;
}

function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
}
