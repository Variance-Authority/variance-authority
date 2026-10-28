import { count, textOf, type Reviewed, type ReviewTool } from './review.js';

/**
 * `variance_concerns` — what reviewers suspect about a render.
 *
 * A concern is a reviewer saying "this looks wrong" without deciding anything:
 * a title, optionally a rectangle of the render, what they pointed at, and a
 * trail of states from `open` through `investigating` to `resolved`. It is
 * anchored to the subject, not to the build it was raised in, so a build shows
 * every concern on the subjects it rendered, whichever build raised it. Each
 * concern prints its whole trail, because the note on the step that resolved
 * it is often the only place the answer is written.
 *
 * Read, never written, like `variance_decisions`, and through the same reader:
 * the share token reads concerns and is refused at every route that raises or
 * moves one, so nothing an agent passes here can flag a render or close a flag.
 */

export type ReviewConcernState = 'open' | 'investigating' | 'resolved';

const STATES: readonly ReviewConcernState[] = ['open', 'investigating', 'resolved'];

/** A rectangle on the after image of the build the concern was raised in. */
export interface ReviewConcernRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The component the run attributed the rectangle to, when it attributed one. */
  readonly component?: string;
}

/** One step in a concern's trail. The last one is its state. */
export interface ReviewConcernEvent {
  readonly state: ReviewConcernState;
  readonly by: string;
  readonly at: string;
  readonly note?: string;
  readonly hypothesis?: string;
}

/** One concern on one subject, as the deployment keeps it. */
export interface ReviewConcern {
  readonly id: number;
  /** The build it was raised in. */
  readonly build: string;
  readonly subject: string;
  readonly title: string;
  /** Absent when the concern is about the whole render. */
  readonly region?: ReviewConcernRegion;
  /** What the reviewer pointed at, as they named it. Empty when they pointed at nothing. */
  readonly evidence: readonly string[];
  readonly by: string;
  readonly at: string;
  readonly state: ReviewConcernState;
  readonly events: readonly ReviewConcernEvent[];
}

/** How many concerns stand in each state, over every subject one build showed. */
export type ReviewConcernTally = Readonly<Record<ReviewConcernState, number>>;

/** The concerns a host read for one call, and where it read them. */
export interface ConcernsSubject extends Reviewed {
  /** In the order they were raised, as the deployment answered them. */
  readonly concerns: readonly ReviewConcern[];
  /** Present when the call named a build: the deployment counts that build's concerns. */
  readonly tally?: ReviewConcernTally;
}

/** What one call asked for, after its input was read. */
export interface ConcernsQuery {
  readonly subject?: string;
  /** The concerns on every subject this build showed, whichever build raised them. */
  readonly build?: string;
  readonly state?: ReviewConcernState;
}

/**
 * The call's input, read once: the host fetches the concerns this names, and
 * the answer narrows to the same ones.
 *
 * A call names a subject or a build, as a decisions call does: every concern a
 * project ever raised is a sample under a heading that reads as an answer.
 */
export function concernsQuery(input: Readonly<Record<string, unknown>>): ConcernsQuery {
  const subject = textOf(input, 'subject');
  const build = textOf(input, 'build');
  if (subject === undefined && build === undefined) {
    throw new Error(
      '`variance_concerns` needs a `subject` or a `build`: the subject id whose concerns you want, or a build whose subjects they are on',
    );
  }
  const state = textOf(input, 'state');
  if (state !== undefined && !(STATES as readonly string[]).includes(state)) {
    throw new Error(`\`state\` is one of ${STATES.join(', ')}`);
  }
  return {
    ...(subject === undefined ? {} : { subject }),
    ...(build === undefined ? {} : { build }),
    ...(state === undefined ? {} : { state: state as ReviewConcernState }),
  };
}

export const concerns: ReviewTool<ConcernsSubject> = {
  name: 'variance_concerns',
  route: '/review/concerns',
  description:
    'What reviewers suspect about a render, beside whether its baseline moved: each concern with its title, ' +
    'state (open, investigating or resolved), the region of the render it is about, what the reviewer ' +
    'pointed at, and every step since with its note. A build shows every concern on the subjects it ' +
    'rendered, whichever build raised it. Read with the share token, which reads and never decides — ' +
    'nothing here raises, moves or resolves a concern. Ask this to learn which renders a reviewer flagged ' +
    'and why, before changing what they flagged or proposing its baseline.',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'The concerns on this subject id. Pass this, `build`, or both.' },
      build: {
        type: 'string',
        description: 'The concerns on every subject this build showed. Pass this, `subject`, or both.',
      },
      state: {
        type: 'string',
        enum: [...STATES],
        description: 'Optional. Only the concerns that stand in this state.',
      },
    },
    additionalProperties: false,
  },

  query(input) {
    const query = concernsQuery(input);
    return { subject: query.subject, build: query.build, state: query.state };
  },

  run(subject, input) {
    const query = concernsQuery(input);
    // `build` is narrowed by the deployment alone: a concern names the build
    // that raised it, and the build asked about may only have shown it.
    const read = subject.concerns.filter(
      (concern) => (query.subject === undefined || concern.subject === query.subject) &&
        (query.state === undefined || concern.state === query.state),
    );
    const on = [
      ...(query.subject === undefined ? [] : [` on ${query.subject}`]),
      ...(query.build === undefined ? [] : [` seen in build ${query.build}`]),
      ...(query.state === undefined ? [] : [` that ${read.length <= 1 ? 'is' : 'are'} ${query.state}`]),
    ].join('');
    const tally = query.build === undefined || subject.tally === undefined
      ? []
      : [
        `build ${query.build}, over every subject it showed: ` +
          STATES.map((state) => `${String(subject.tally![state])} ${state}`).join(', ') + '.',
      ];
    if (read.length === 0) return [`${subject.from} records no concern${on}.`, ...tally].join('\n');

    const lines = [`${subject.from}: ${count(read.length, 'concern')}${on}, in the order they were raised.`, ...tally, ''];
    for (const concern of read) {
      lines.push(`  #${String(concern.id)}  ${concern.state}  ${concern.subject}  ${concern.build}  ${JSON.stringify(concern.title)}`);
      if (concern.region !== undefined) lines.push(`      region ${placeOf(concern.region)}`);
      if (concern.evidence.length > 0) lines.push(`      evidence ${concern.evidence.join(', ')}`);
      for (const event of concern.events) {
        lines.push(
          `      ${event.at}  ${event.state}  ${event.by}` +
            (event.note === undefined ? '' : `  ${JSON.stringify(event.note)}`) +
            (event.hypothesis === undefined ? '' : `  hypothesis ${JSON.stringify(event.hypothesis)}`),
        );
      }
    }
    return lines.join('\n');
  },
};

function placeOf(region: ReviewConcernRegion): string {
  return `${String(region.x)},${String(region.y)} ${String(region.width)}x${String(region.height)}` +
    (region.component === undefined ? '' : ` on ${region.component}`);
}
