import type { VariationRecord } from '@variance-authority/report';
import type { Tool } from './tool.js';

/**
 * `variance_variations` — subjects that are other subjects on purpose.
 *
 * The third axis, and the smallest. `variance_summary` and everything under it
 * answer *this subject against its baseline*: two revisions, one thing.
 * `variance_composition` answers *these subjects against each other*, at one
 * commit, over what they are built from. This answers a question neither can
 * reach, because it is not a question about a diff at all:
 *
 * > What does the flag actually do?
 *
 * A new arm behind a feature flag, a second viewport, the dark scheme, a backend
 * fixture returning the empty state — each arrives as a new subject, and a new
 * subject is `new`: one baseline written, an empty diff, nothing said. Every run
 * afterwards compares it only to itself, so the difference the arm exists *for*
 * is the one difference nothing in the suite has ever measured.
 *
 * A subject that declares a parent gets it measured. What is reported is the
 * difference between the two, in this run, with no verdict attached — a dark
 * story is darker than its light parent and that is not a regression. What it
 * is, is reviewable: the difference carries a digest that holds still while the
 * two subjects move together, so *the flag changed what it does* becomes a thing
 * a person can see rather than infer.
 */

export const variations: Tool = {
  name: 'variance_variations',
  description:
    'Subjects this run measured against another subject rather than against a baseline — a ' +
    'feature flag’s other arm, a second viewport, a dark scheme, a backend fixture — where the ' +
    'subject declared which one it is a variation of. Says what the variation actually changes ' +
    '(which bands, which components) and carries a digest of that difference which stays the ' +
    'same for as long as parent and variation move together. Nothing here is a verdict: a ' +
    'variation is a difference somebody built. Ask this to find out what a flag or a theme does, ' +
    'or when reviewing a change to a subject that has arms.',
  inputSchema: {
    type: 'object',
    properties: {
      subject: {
        type: 'string',
        description: 'Optional. One variation’s entry, instead of every variation in the run.',
      },
    },
    additionalProperties: false,
  },

  run(report, input) {
    const declared = report.variations;
    if (declared === undefined || declared.length === 0) return ABSENT;

    const wanted = typeof input['subject'] === 'string' ? input['subject'] : undefined;
    if (wanted === undefined) return whole(declared);

    const entry = declared.find((record) => record.subject === wanted);
    if (entry === undefined) return missing(declared, wanted);
    return render(entry);
  },
};

/**
 * The absence, said as an absence.
 *
 * A run with no variations is the normal run, and it is not evidence that the
 * suite has no arms — it is evidence that no subject said which subject it
 * varies. That distinction is the whole finding here, so the answer names the
 * declaration rather than reporting an empty list.
 */
const ABSENT =
  'No subject in this run declared itself a variation of another, so nothing was measured on ' +
  'this axis. That is not a claim that the suite has no variants: a feature flag’s second arm, ' +
  'a dark story or a narrow-viewport route are ordinary subjects here, each compared only to its ' +
  'own baseline, and the difference between an arm and what it varies is measured only where a ' +
  'subject carries a `variance-parent:<id>` tag naming the subject it varies.';

/**
 * Everything, with the ones somebody wrote down first.
 *
 * The split is not cosmetic. A tag is a statement about two subjects; a name is
 * a convention being read back, and a suite that names its variants gets many of
 * those at once. Printing them interleaved would make the weakest entries the
 * bulk of the answer and put them alongside the strongest with nothing marking
 * the difference.
 */
function whole(records: readonly VariationRecord[]): string {
  const measured = records.filter((record) => record.digest !== undefined);
  const unmeasured = records.filter((record) => record.digest === undefined);
  const identical = measured.filter((record) => record.identical === true);
  const stated = records.filter((record) => record.how !== 'named');
  const named = records.filter((record) => record.how === 'named');

  return [
    `${records.length} variation(s) — ${measured.length} measured` +
      (identical.length === 0 ? '' : `, ${identical.length} of them identical to their parent`) +
      (unmeasured.length === 0 ? '' : `, ${unmeasured.length} not compared`) +
      `; ${stated.length} declared with a tag, ${named.length} read off the names`,
    ...(stated.length === 0 ? [] : ['', 'declared', '', ...stated.map(render)]),
    ...(named.length === 0
      ? []
      : [
          '',
          'named — nobody declared these pairs; each subject’s id extends its parent’s id, so ' +
            'the link is only as good as the naming convention',
          '',
          ...named.map(render),
        ]),
  ].join('\n');
}

function render(record: VariationRecord): string {
  const head =
    record.parent === undefined
      ? record.subject
      : `${record.subject} ← ${record.parent}${bands(record.bands)}`;

  return [
    head,
    `  ${record.because}`,
    ...(record.components === undefined
      ? []
      : [`  components: ${record.components.join(', ')}`]),
    ...(record.unobserved === undefined
      ? []
      : [`  unobserved here: ${record.unobserved.join(', ')}`]),
    // Listed beside `unobserved` rather than folded into it. An agent deciding
    // whether this pair settles a question needs the two apart: an unobserved
    // band has no answer, and a narrowed one has an answer to a smaller question
    // than the band's name implies. `because` above says what each one covered.
    ...(record.narrowed === undefined
      ? []
      : [`  narrowed here: ${record.narrowed.join(', ')}`]),
  ].join('\n');
}

function missing(declared: readonly VariationRecord[], wanted: string): string {
  return (
    `\`${wanted}\` declared no parent in this run, so there is no variation to describe. Every ` +
    `subject that did: ${declared.map((record) => record.subject).join(', ')}`
  );
}

/** Empty means the two are alike everywhere observed, never *no band*. */
function bands(bands: readonly string[] | undefined): string {
  return bands === undefined || bands.length === 0 ? '' : ` (${bands.join(', ')})`;
}
