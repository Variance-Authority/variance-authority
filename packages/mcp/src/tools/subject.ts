import type { NotObserved, ObservationRecord, RunReport } from '@variance-authority/report';
import { stringArg } from './tool.js';

/**
 * Naming a subject, and what to say when the run has nothing to say about it.
 *
 * Shared by the two tools an agent points at a single subject — `variance_describe`
 * and `variance_explain_verdict` — and separate from both because the decision
 * encoded here belongs to neither. A subject the run planned and could not see
 * has to be answered rather than refused, and a lookup that returns `undefined`
 * leaves each caller free to forget that on its own schedule.
 */

/**
 * A subject named in the run, and which of the two lists it came from.
 *
 * A union rather than `ObservationRecord | undefined` so that "the run did not
 * observe this" cannot be handled by accident. Every caller has to decide what to
 * say about a subject with no observation, and the answer is never a verdict.
 */
export type Located =
  | { readonly observed: true; readonly observation: ObservationRecord }
  | { readonly observed: false; readonly entry: NotObserved };

export function subjectOf(report: RunReport, input: Readonly<Record<string, unknown>>): Located {
  const subject = stringArg(input, 'subject');

  const observation = report.observations.find((entry) => entry.subject === subject);
  if (observation !== undefined) return { observed: true, observation };

  // The coverage list is searched too, and this is the point of it. A subject the
  // run planned and could not see is a subject an agent will ask about; refusing
  // the name tells it the subject does not exist, which is both false and the
  // conclusion that ends the investigation.
  const skipped = report.notObserved?.find((entry) => entry.subject === subject);
  if (skipped !== undefined) return { observed: false, entry: skipped };

  // Listing the alternatives rather than only refusing: an agent that gets
  // "unknown subject" retries with another guess, and an agent that gets the
  // list picks the right one.
  throw new Error(
    `unknown subject "${subject}"; this run has: ` +
      [
        ...report.observations.map((entry) => entry.subject),
        ...(report.notObserved ?? []).map((entry) => entry.subject),
      ].join(', '),
  );
}

/**
 * What to say about a subject with no observation — the CLI's wording, verbatim.
 *
 * Duplicated text rather than a shared helper only because the packages point the
 * other way round, and the duplication is deliberate where drift would be worst:
 * a human running `variance report --subject x` and an agent calling
 * `variance_describe` on the same subject must be told the same thing, or the two
 * of them will argue about a run neither can re-observe.
 */
export function unobserved(entry: NotObserved): string {
  return [
    `[not observed] ${entry.subject}`,
    entry.because,
    notObservedSentence(entry.kind),
  ].join('\n');
}

/**
 * What the reader should do about a subject nobody looked at.
 *
 * One sentence per kind, and the three are different instructions. `failed` is
 * work; `excluded` is a decision already on the record; `unreached` is the run
 * having proved the change cannot arrive here, which is the only one of the
 * three that is evidence rather than an absence of it.
 */
export function notObservedSentence(kind: NotObserved['kind']): string {
  switch (kind) {
    case 'excluded':
      return 'This was excluded by configuration, not by a failure.';
    case 'unreached':
      return 'The change under review cannot reach this subject, so it was not rendered.';
    default:
      return 'The run meant to observe this and could not. It is not a pass.';
  }
}
