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
 */
export const findings: Tool = {
  name: 'variance_findings',
  description:
    'Accessibility defects found in the renders themselves, with no baseline involved: a ' +
    'control with no accessible name, a skipped heading level, a broken label association. ' +
    'Grouped by rule, each naming the component and the file. These are present on the ' +
    'first run and are invisible to any comparison, so they do not affect the verdict.',
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

    return [...byRule]
      .map(([rule, entries]) => {
        // Same finding, same component, several subjects: one edit, so one line
        // with the subjects counted rather than one line per place it shows up.
        const places = new Map<string, { what: string; file?: string; subjects: string[] }>();
        for (const { subject, finding } of entries) {
          const key = `${finding.component ?? finding.path}\u0000${finding.what}`;
          const place = places.get(key) ?? {
            what: finding.what,
            ...(finding.file !== undefined ? { file: finding.file } : {}),
            subjects: [],
          };
          place.subjects.push(subject);
          places.set(key, place);
        }

        return [
          `${rule} — ${entries.length} occurrence(s)`,
          ...[...places.values()].map((place) => {
            const reach =
              place.subjects.length === 1
                ? place.subjects[0]
                : `${place.subjects.length} subjects: ${place.subjects.slice(0, 3).join(', ')}` +
                  (place.subjects.length > 3 ? ', …' : '');

            return `  ${place.what}\n    ${place.file ?? '(no source index)'} — in ${reach}`;
          }),
        ].join('\n');
      })
      .join('\n\n');
  },
};
