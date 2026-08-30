import {
  AGE_WORDS,
  ageOf,
  arrivalLine,
  bandTitle,
  carriedLine,
  mixedAges,
} from '@variance-authority/report';
import type { Age } from '@variance-authority/report';
import type { Tool } from './tool.js';

/**
 * `variance_findings` — the one answer here that reads no comparison.
 *
 * Alone in a module because nothing else in this package groups by anything but
 * a subject. This tool inverts that twice — by rule, then by the place the rule
 * fired — and both inversions exist for the same reason the docket does: the
 * unit a reader acts on is an edit, not an occurrence.
 */

/**
 * Defects in the render itself, which no comparison could have reported.
 *
 * A separate tool rather than part of `variance_describe` because it answers a
 * different question. `describe` answers "what did this change do"; this answers
 * "what is wrong with this component regardless of whether anyone touched it" —
 * and the second is the one a comparison structurally cannot reach, since a
 * control that never had an accessible name compares equal to itself forever.
 *
 * Grouped by rule rather than by subject. One missing `alt` in twelve stories is
 * one edit to one component, and listing it twelve times under twelve subject
 * headings is the same fatigue the docket exists to prevent.
 *
 * ## Two things an agent cannot act on this list without
 *
 * **What kind of defect it is.** Most of these rules are accessibility and the
 * description used to say all of them were, which is wrong about the two that
 * are not — a string the locale pass never translated is a content defect, and
 * a box past its container's edge is a layout one. The band is the same word the
 * project blocks on, so the heading a reader sees and the policy that stops
 * their merge are the same word.
 *
 * **Whether it is theirs.** A defect the baseline carried too is somebody else's
 * afternoon, and an agent told twelve defects with no dating will either fix
 * twelve or fix none. The date is only ever printed from a record; nothing here
 * infers it from an absence — and the rules holding a defect this change brought
 * are listed before the rules holding only inherited ones, so an agent that reads
 * the first group and stops has read the part it can act on.
 */
export const findings: Tool = {
  name: 'variance_findings',
  description:
    'Defects found in the renders themselves, with no baseline involved: mostly accessibility ' +
    '— a control with no accessible name, a skipped heading level, a broken label ' +
    'association — and some content and layout. Grouped by rule, each naming the band, the ' +
    'component, the file, and whether the baseline already carried it. These are invisible to ' +
    'any comparison, so they do not affect the verdict.',
  inputSchema: {
    type: 'object',
    properties: {
      rule: { type: 'string', description: 'Optional. Only findings of this rule.' },
    },
    additionalProperties: false,
  },

  run(report, input) {
    const wanted = typeof input?.['rule'] === 'string' ? input['rule'] : undefined;

    const all = report.observations.flatMap((observation) =>
      (observation.findings ?? [])
        .filter((finding) => wanted === undefined || finding.rule === wanted)
        .map((finding) => ({ subject: observation.subject, finding })),
    );

    if (all.length === 0) {
      if (wanted !== undefined) return `No findings for rule ${wanted}.`;

      const inspected = report.observations.filter((o) => o.findings !== undefined).length;

      // Two different sentences, because they are two different claims. A report
      // whose writer never inspected anything has not found the renders clean;
      // it has not looked at them, and an agent told otherwise acts on it.
      return inspected === 0
        ? 'Nothing in this report was inspected — no observation carries a findings list, ' +
            'so this is not evidence that the renders were clean.'
        : `No findings across ${inspected} inspected subject(s).`;
    }

    const byRule = new Map<string, typeof all>();
    for (const entry of all) {
      const bucket = byRule.get(entry.finding.rule) ?? [];
      bucket.push(entry);
      byRule.set(entry.finding.rule, bucket);
    }

    // Printed per place only where the lines around it disagree. On a report
    // written before the marks were kept, `not dated` on every line is a column
    // of one repeated word, and the lead sentence has already said it.
    const dated = mixedAges(all.map((entry) => entry.finding));

    // Rules that hold something this change brought, first. The band order is the
    // report's own and it is a claim about severity; this is a claim about whose
    // afternoon it is, and it outranks severity for the length of one review.
    const ranked = [...byRule].sort(
      (left, right) =>
        Number(right[1].some(({ finding }) => ageOf(finding) === 'new')) -
        Number(left[1].some(({ finding }) => ageOf(finding) === 'new')),
    );

    const groups = ranked.map(([rule, entries]) => {
      // Same finding, same component, several subjects: one edit, so one line
      // with the subjects counted rather than one line per place it shows up.
      // The age joins the key for the same reason it is drawn on the row: one
      // rule firing on an element the baseline had and on one it did not is two
      // findings, and folding them files the new one under the old one's date.
      const places = new Map<string, { what: string; age: Age; file?: string; subjects: string[] }>();
      for (const { subject, finding } of entries) {
        const age = ageOf(finding);
        const key = `${finding.component ?? finding.path}\u0000${finding.what}\u0000${age}`;
        const place = places.get(key) ?? {
          what: finding.what,
          age,
          ...(finding.file !== undefined ? { file: finding.file } : {}),
          subjects: [],
        };
        place.subjects.push(subject);
        places.set(key, place);
      }

      const band = entries[0]?.finding.band;

      return [
        `${band === undefined ? '' : `${bandTitle(band)} · `}${rule} — ` +
          `${entries.length} occurrence(s)`,
        ...[...places.values()].map((place) => {
          const reach =
            place.subjects.length === 1
              ? place.subjects[0]
              : `${place.subjects.length} subjects: ${place.subjects.slice(0, 3).join(', ')}` +
                (place.subjects.length > 3 ? ', …' : '');

          return (
            `  ${place.what}${dated ? ` — ${AGE_WORDS[place.age]}` : ''}` +
            `\n    ${place.file ?? '(no source index)'} — in ${reach}`
          );
        }),
      ].join('\n');
    });

    const subjects = new Set(all.map((entry) => entry.subject)).size;
    const found = all.map((entry) => entry.finding);
    const lead = [
      arrivalLine(found),
      carriedLine(found),
      `${all.length} occurrence(s) across ${subjects} subject(s), read without a baseline`,
    ]
      .filter((clause): clause is string => clause !== undefined)
      .join(' · ');

    return [lead, ...groups].join('\n\n');
  },
};
