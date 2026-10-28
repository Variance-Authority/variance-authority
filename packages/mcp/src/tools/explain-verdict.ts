import type { NotObserved } from '@variance-authority/report';
import { subjectOf, unobserved } from './subject.js';
import type { Tool } from './tool.js';

/**
 * `variance_explain_verdict` — the answers that are not about the code.
 *
 * Kept apart from `variance_describe` although both start by locating a subject.
 * `describe` answers about pixels that moved; this one answers about a comparison
 * that never happened, and its whole job is to end with "there is no edit to
 * make here" — a sentence a region list cannot say, and one that stops being
 * said the moment the two tools share a body and a caller reaches for the
 * regions because they are already in scope.
 */

/**
 * Why a verdict is not a fact about the code.
 *
 * `new` and a change painted under another identity are the two an agent will
 * otherwise treat as failures and try to fix in code. `new` is not about the
 * code at all. A change under a moved machine or recipe is shown like any other
 * (ADR-0090), but what moved is its first suspect: the agent reads the cause
 * before the regions, and compares the subject with the others under it.
 *
 * A subject with no observation at all is the third such case and the worst one
 * to refuse. "Unknown subject" tells an agent the subject does not exist, so it
 * stops asking; the truth is that the subject exists and nothing is known about
 * it, which is the opposite conclusion.
 */
export const explain: Tool = {
  name: 'variance_explain_verdict',
  description:
    'Why a verdict may not be a code problem. A change painted under another machine, or an ' +
    'older recipe of this tool, names what moved as its cause; `new` means no baseline exists; a ' +
    'subject in the coverage list was never observed at all. Call this before attempting a fix.',
  inputSchema: {
    type: 'object',
    properties: { subject: { type: 'string' } },
    required: ['subject'],
    additionalProperties: false,
  },

  run(report, input) {
    const located = subjectOf(report, input);

    if (!located.observed) {
      return [
        unobserved(located.entry),
        '',
        nothingCompared(located.entry.kind),
      ].join('\n');
    }

    const { observation } = located;

    switch (observation.verdict) {
      case 'new':
        return [
          observation.because,
          '',
          'Nothing has regressed; there is no baseline to regress from. Record one, ' +
            'or compare ephemerally against the previous revision.',
        ].join('\n');
      case 'unchanged':
        return `${observation.subject} was compared and did not change: ${observation.because}`;
      case 'ignored':
        return [
          observation.because,
          '',
          'This subject changed. Every changed pixel landed inside a region the project ' +
            'excluded, so the run is green and nothing here was reviewed. That is a ' +
            'configuration decision, not a fact about the code: if the change should have ' +
            'been caught, the ignore is too wide.',
        ].join('\n');
      case 'changed': {
        const moved = observation.signals?.moved ?? [];
        if (moved.length === 0) {
          return `${observation.subject} was compared and changed. Call variance_describe for the regions.`;
        }
        const what = observation.signals?.identity === 'recipe' ? "this tool's recipe" : 'the machine';
        return [
          observation.because,
          '',
          `The two images were painted under different identities, and ${what} moved: ` +
            `${moved.join('; ')}. That is the first suspect for every pixel here, not the code. ` +
            'Before an edit, compare it with the other subjects under the same cause: a change ' +
            'shaped like theirs is the move, one shaped unlike them is worth reading. Call ' +
            'variance_describe for the regions, and accept the images once the move is the whole story.',
        ].join('\n');
      }
    }
  },
};

/** What an agent should do about a subject nothing was compared for. */
function nothingCompared(kind: NotObserved['kind']): string {
  switch (kind) {
    case 'excluded':
      return (
        'Nothing was compared, so nothing is known about this subject. There is no code ' +
        'change to make here; if it should be watched, change the exclusion.'
      );
    case 'unreached':
      return (
        'Nothing was compared, and nothing needed to be: the run resolved that this ' +
        'change cannot reach this subject. There is no code change to make here.'
      );
    default:
      return (
        'Nothing was compared, so nothing is known about this subject — an absent ' +
        'observation is not an unchanged one. Fix whatever stopped the run from seeing ' +
        'it before treating any part of this run as a pass for this subject.'
      );
  }
}
