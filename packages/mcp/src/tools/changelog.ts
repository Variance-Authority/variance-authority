import {
  changelogBody,
  changelogOf,
  isRecorded,
  promotionOf,
  selectByShape,
  whyNotWhole,
  type ChangelogSelection,
  type ObservationRecord,
  type RunReport,
} from '@variance-authority/report';
import type { Tool } from './tool.js';

/**
 * `variance_changelog` — what the baseline update would say, before it is made.
 *
 * Every other tool here answers *what changed*. This one answers *what would be
 * written down about it*, and the difference matters because of where that
 * writing goes: a baseline update is explained in the commit that carries it or
 * in a review database, and both are written at the moment of acceptance and
 * never again. An agent that runs `accept` without knowing what the record will
 * say has already written it.
 *
 * ## Why it previews rather than proposes prose
 *
 * The answer is not this tool's phrasing of the change. It is the lines the
 * commit will actually carry, rendered by the same function that renders them
 * into the commit — `changelogBody` over a record from `changelogOf`. A tool
 * that wrote its own summary would be a second account of a baseline update,
 * edited separately from the first, and the two would disagree in the direction
 * that matters: the one an agent read would not be the one that survived.
 *
 * The subject set is chosen by the same rules `accept` applies, for the same
 * reason. `promotionOf` refuses an unstable subject and a subject the run left
 * no image for; a preview that counted those would promise entries the command
 * then refuses by name, which is worse than not previewing at all.
 *
 * ## What it deliberately does not do
 *
 * It does not render the trailers. Those are the record — versioned, encoded,
 * append-only once committed — and a record exists when somebody accepted
 * something. A trailer an agent could copy out of a preview is a record of a
 * promotion that never happened, which is the one artifact this whole mechanism
 * is arranged to prevent.
 *
 * It reads no clock. The instant a record carries is the instant of acceptance,
 * and acceptance happens in another process, later, possibly not at all.
 */

export const changelog: Tool = {
  name: 'variance_changelog',
  description:
    'Preview what accepting this run would write into the baseline changelog: the same lines ' +
    'the commit message will carry, the subjects that would land in it, and the subjects that ' +
    'would be refused and why. Takes the same selection as `variance accept` — a shape, named ' +
    'subjects, or everything. Ask this before proposing an accept command; the record is ' +
    'written once, at acceptance, and is the only explanation of the baseline that outlives ' +
    'the run.',
  inputSchema: {
    type: 'object',
    properties: {
      shape: {
        type: 'string',
        description:
          'Optional. A shape digest from `variance_changes`. Previews `accept --shape`, which ' +
          'takes the subjects this shape wholly explains and refuses the rest by name.',
      },
      subjects: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional. Subject ids, as `accept` would take them by name.',
      },
    },
    additionalProperties: false,
  },

  run(report, input) {
    const shape = typeof input['shape'] === 'string' ? input['shape'] : undefined;
    const named = Array.isArray(input['subjects'])
      ? input['subjects'].filter((value): value is string => typeof value === 'string')
      : undefined;

    if (shape !== undefined && named !== undefined && named.length > 0) {
      // Refused rather than resolved by precedence. These are two different
      // commands, and picking one silently would preview an update the agent did
      // not ask about and then hand it a command that performs the other.
      return (
        'Ask for one selection at a time: a shape, or subjects by name. They are two ' +
        'different accept commands and this would preview one while naming the other.'
      );
    }

    const selection: ChangelogSelection =
      shape !== undefined ? 'shape' : named !== undefined && named.length > 0 ? 'named' : 'all';

    const chosen = select(report, shape, named);
    if (typeof chosen === 'string') return chosen;

    const promotable: string[] = [];
    const refused: { readonly subject: string; readonly because: string }[] = [...chosen.refused];
    let alreadyBaseline = 0;

    for (const observation of chosen.targets) {
      const promotion = promotionOf(observation);
      if (promotion.kind === 'promotable') promotable.push(observation.subject);
      else if (promotion.kind === 'already-baseline') alreadyBaseline += 1;
      else refused.push({ subject: observation.subject, because: promotion.because });
    }

    const record = changelogOf({
      report,
      accepted: promotable,
      selection,
      // The run's own instant, never this process's. A record is stamped when
      // somebody accepts, in another process; a clock read here would put a time
      // in a preview that the record will not carry.
      at: report.at,
    });

    if (!isRecorded(record)) {
      return [
        `Nothing would be recorded: ${record.because}.`,
        ...(refused.length > 0
          ? ['', `Refused (${String(refused.length)}):`, ...refused.map(line)]
          : []),
        ...(alreadyBaseline > 0
          ? ['', `${String(alreadyBaseline)} subject(s) already are the baseline.`]
          : []),
      ].join('\n');
    }

    const unshaped = promotable.filter((subject) => !inRecord(record.entries, subject));

    return [
      `Accepting this would record ${String(record.entries.length)} change(s) across ` +
        `${String(promotable.length)} subject(s). These are the lines the commit will carry:`,
      '',
      ...changelogBody(record),
      '',
      `  ${command(selection, shape, promotable)}`,
      ...(unshaped.length > 0
        ? [
            '',
            `Promoted but not described (${String(unshaped.length)}): ${unshaped.join(', ')}`,
            '  The run named no difference shape in these, so the record counts them and ' +
              'cannot say what changed in them. Nothing later can recover it.',
          ]
        : []),
      ...(refused.length > 0
        ? ['', `Refused, and absent from the record (${String(refused.length)}):`, ...refused.map(line)]
        : []),
      ...(alreadyBaseline > 0
        ? ['', `${String(alreadyBaseline)} subject(s) already are the baseline and record nothing.`]
        : []),
    ].join('\n');
  },
};

/**
 * The subjects the named selection reaches, or the sentence saying it reaches none.
 *
 * `--shape` carries its own refusals — the subjects where the shape is present
 * beside something else — and they are part of the preview rather than a detail
 * of the command, because they are the part of the change this update would
 * leave in the suite.
 */
function select(
  report: RunReport,
  shape: string | undefined,
  named: readonly string[] | undefined,
):
  | string
  | {
      readonly targets: readonly ObservationRecord[];
      readonly refused: readonly { readonly subject: string; readonly because: string }[];
    } {
  if (shape !== undefined) {
    const selected = selectByShape(report.observations, new Set([shape]));
    if (selected.whole.length === 0 && selected.partial.length === 0) {
      return (
        `The shape ${shape} appears in no region of this run. A fingerprint is copied from a ` +
        'region in a report; check it came from this one.'
      );
    }
    return {
      targets: selected.whole,
      refused: selected.partial.map((observation) => ({
        subject: observation.subject,
        because: whyNotWhole(observation),
      })),
    };
  }

  if (named !== undefined && named.length > 0) {
    const targets: ObservationRecord[] = [];
    const missing: string[] = [];

    for (const subject of named) {
      const found = report.observations.find((entry) => entry.subject === subject);
      if (found === undefined) missing.push(subject);
      else targets.push(found);
    }

    if (targets.length === 0) {
      return `None of those subjects are in this run: ${missing.join(', ')}.`;
    }

    return {
      targets,
      refused: missing.map((subject) => ({
        subject,
        because: 'this run has no observation for it, so `accept` would refuse the command',
      })),
    };
  }

  return { targets: report.observations, refused: [] };
}

/**
 * The command that writes it, spelled out.
 *
 * `--message-file` is on every one of them. The message is where the record
 * goes, and an accept run without it promotes the images and explains nothing —
 * which is the state this tool exists to make visible before it happens.
 */
function command(
  selection: ChangelogSelection,
  shape: string | undefined,
  promotable: readonly string[],
): string {
  const how =
    selection === 'shape'
      ? `--shape ${shape ?? ''}`
      : selection === 'named'
        ? promotable.map((subject) => `"${subject}"`).join(' ')
        : '--all';

  return `variance accept ${how} --message-file .variance/commit-message.txt`;
}

function inRecord(
  entries: readonly { readonly subjects: readonly string[] }[],
  subject: string,
): boolean {
  return entries.some((entry) => entry.subjects.includes(subject));
}

function line(refusal: { readonly subject: string; readonly because: string }): string {
  return `  ${refusal.subject} — ${refusal.because}`;
}
