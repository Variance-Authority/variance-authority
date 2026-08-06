import type { RegionRecord } from '@variance-authority/report';
import { subjectOf, unobserved } from './subject.js';
import type { Tool } from './tool.js';

/**
 * `variance_describe`, and the region format nothing else prints.
 *
 * `regionLine` stays with the tool because the region list is this answer's whole
 * substance, and everything around it is an ordering decision that belongs to
 * this tool rather than to regions in general: the leak warning above the list
 * because it changes what every line below means, the findings before it because
 * an `unchanged` subject can carry nothing else, and the truncation count after
 * it because a capped list that does not say so reads as a complete one.
 */

/**
 * One subject, in full: what changed, where it is, and which file to open.
 *
 * The tool an agent calls after the summary, and the one that has to be complete
 * — an agent that has to ask three more questions to locate an edit will guess
 * instead.
 */
export const describe: Tool = {
  name: 'variance_describe',
  description:
    'Everything known about one subject: the ranked regions, the component each belongs to, ' +
    'a landmark description of where it is on the page, the source file to edit, and each ' +
    "region's shape fingerprint — which is what `variance accept --shape` and an `ignore` " +
    'rule are keyed on when a difference is not a code problem. Causes are listed before ' +
    'collateral. A subject the run did not observe is answered with why, not refused.',
  inputSchema: {
    type: 'object',
    properties: { subject: { type: 'string', description: 'Subject id from variance_summary.' } },
    required: ['subject'],
    additionalProperties: false,
  },

  run(report, input) {
    const located = subjectOf(report, input);
    if (!located.observed) return unobserved(located.entry);
    const { observation } = located;

    const lines = [
      `[${label(observation)}] ${observation.subject}`,
      observation.because,
      // Ahead of the leak note, because it disqualifies that one too. A clean
      // world re-collection was never taken on this subject — its answer would
      // have been a comparison between two readings that do not agree anyway —
      // so there is no order-dependence claim here to place second.
      ...(observation.unstable !== undefined
        ? [
            `NOT A COMPONENT CHANGE: ${observation.unstable.because}. The regions below are`,
            'the difference between one of those two readings and the baseline, so which',
            'ones appear here is decided by a race. Do not review them and do not accept',
            'this subject. Fix what moves between two readings of the same page' +
              (observation.unstable.components.length === 0
                ? ', starting from the subject itself — no snapshot was collected, so nothing'
                  + ' could name the component that moved.'
                : `, starting at ${unstableAt(observation.unstable.components)}` +
                  (observation.unstable.bands.length === 0
                    ? '.'
                    : ` (${observation.unstable.bands.join(', ')}).`)),
          ]
        : []),
      // Placed second, directly under the verdict, because it changes what every
      // line below it means. The regions are still correct — those pixels really
      // did move, in those components — but they are the shape of a leak rather
      // than the shape of an edit, and an agent that reads the region list first
      // starts editing a component whose source nobody changed.
      ...(observation.unstable === undefined && observation.alone?.reproduced === false
        ? [
            `NOT A COMPONENT CHANGE: ${observation.alone?.because}. The regions below are real`,
            'but they are what the leak did, not what an edit did. Do not change these',
            'components. Find the subject that writes the state this one reads by bisecting',
            'run order — the run cannot name it, because module-level state is invisible to',
            'anything a rendered document can observe about itself.',
          ]
        : []),
      ...(observation.missingFonts !== undefined && observation.missingFonts.length > 0
        ? [
            `warning: the renderer lacked ${observation.missingFonts.join(', ')}; ` +
              'these images are of a substituted font and their metrics are not the product’s',
          ]
        : []),
    ];

    // Findings before regions. A subject can be `unchanged` and still carry
    // them, in which case they are the only thing this tool has to say, and a
    // reader who stopped at "nothing changed" would never reach them.
    if (observation.findings !== undefined && observation.findings.length > 0) {
      lines.push(
        '',
        `${observation.findings.length} finding(s) in this render, independent of the verdict:`,
        ...observation.findings.map(
          (finding) =>
            `  [${finding.rule}] ${finding.what}` +
            (finding.file !== undefined ? `\n    ${finding.file}` : ''),
        ),
      );
    }

    if (observation.regions.length === 0) return lines.join('\n');

    lines.push('', ...observation.regions.map(regionLine));

    if (observation.truncated !== undefined && observation.truncated.regions > 0) {
      // Never a silent cap: a truncated list that does not say so reads as
      // complete coverage, and the reader has no way to tell the difference.
      lines.push(
        `+${observation.truncated.regions} smaller region(s) not listed ` +
          `(${observation.truncated.pixels}px)`,
      );
    }

    if (observation.images !== undefined) {
      lines.push(
        '',
        'images: ' +
          Object.entries(observation.images)
            .map(([kind, path]) => `${kind}=${path}`)
            .join(' '),
      );
    }

    return lines.join('\n');
  },
};

/**
 * What the subject *is*, which is not always its verdict.
 *
 * Three words over one, and the order is the precedence: instability disqualifies
 * the clean-world answer, which in turn re-reads the verdict. All three subjects
 * are `changed` — the pixels did move — and all three need different work, so a
 * reader given the verdict alone acts on the wrong one two times out of three.
 */
function label(observation: {
  readonly verdict: string;
  readonly unstable?: unknown;
  readonly alone?: { readonly reproduced: boolean };
}): string {
  if (observation.unstable !== undefined) return 'unstable';
  if (observation.alone?.reproduced === false) return 'order-dependent';
  return observation.verdict;
}

/** The unstable components as `Name file:line`, which is what an editor opens. */
function unstableAt(
  components: readonly { readonly name: string; readonly file?: string }[],
): string {
  return components
    .map((component) =>
      component.file === undefined ? component.name : `${component.name} ${component.file}`,
    )
    .join(', ');
}

function regionLine(region: RegionRecord): string {
  const head = region.unattributed === true
    ? `unattributed — a region no box contained, which usually means the scale or origin was wrong`
    : (region.component ?? region.path ?? 'unknown');

  return [
    `  ${region.cause ? 'cause     ' : 'collateral'} ${region.pixels}px ` +
      `at ${region.x},${region.y} ${region.width}×${region.height} — ${head}`,
    region.where !== undefined ? `      in ${region.where}` : null,
    region.file !== undefined ? `      ${region.file}` : null,
    // The digest, on the region it describes. An agent's two non-code responses
    // to a recurring difference are `variance accept --shape <it>` and an
    // `ignore` rule keyed on it, and neither is reachable without the value —
    // printing it in a different section would make an agent guess which line it
    // belonged to.
    region.fingerprint !== undefined ? `      shape ${region.fingerprint}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
