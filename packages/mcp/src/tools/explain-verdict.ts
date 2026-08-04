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
 * Why a subject has no comparison.
 *
 * `incomparable` and `new` are the two verdicts an agent will otherwise treat as
 * failures and try to fix in code, which is exactly wrong: neither is about the
 * code. This makes the reason legible enough to act on — or to decide not to.
 *
 * A subject with no observation at all is the third such case and the worst one
 * to refuse. "Unknown subject" tells an agent the subject does not exist, so it
 * stops asking; the truth is that the subject exists and nothing is known about
 * it, which is the opposite conclusion.
 */
export const explain: Tool = {
  name: 'variance_explain_verdict',
  description:
    'Why a subject was not compared. `incomparable` means a baseline exists but another ' +
    'machine rendered it; `new` means none exists; a subject in the coverage list was never ' +
    'observed at all. None is a code problem — call this before attempting a fix.',
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
        located.entry.kind === 'excluded'
          ? 'Nothing was compared, so nothing is known about this subject. There is no code ' +
            'change to make here; if it should be watched, change the exclusion.'
          : 'Nothing was compared, so nothing is known about this subject — an absent ' +
            'observation is not an unchanged one. Fix whatever stopped the run from seeing ' +
            'it before treating any part of this run as a pass for this subject.',
      ].join('\n');
    }

    const { observation } = located;

    switch (observation.verdict) {
      case 'incomparable':
        return [
          observation.because,
          '',
          'This is not a code change and cannot be fixed in code. Either run on the machine ' +
            'that wrote the baseline, re-record the baseline on this one, or use an ephemeral ' +
            'comparison, which renders both sides here and needs no stored image at all.',
        ].join('\n');
      case 'new':
        return [
          observation.because,
          '',
          'Nothing has regressed; there is no baseline to regress from. Record one, ' +
            'or compare ephemerally against the previous revision.',
        ].join('\n');
      case 'unchanged':
        return `${observation.subject} was compared and did not change: ${observation.because}`;
      case 'changed':
        return `${observation.subject} was compared and changed. Call variance_describe for the regions.`;
    }
  },
};
