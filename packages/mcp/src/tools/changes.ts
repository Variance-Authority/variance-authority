import { clusterChanges, describeClustering, type Change } from '@variance-authority/report';
import type { Tool } from './tool.js';

/**
 * `variance_changes` — the review, sized before it is started.
 *
 * Every other tool here answers about a *subject*. This one refuses to, and the
 * refusal is the point: forty changed stories are not forty questions, and an
 * agent that walks them one at a time will spend forty tool calls learning what
 * one call can say — that three things happened, one of them explains
 * thirty-one of the subjects, and it is a token edit in `Button`.
 *
 * That reshaping is the difference between an agent that reviews a suite and an
 * agent that transcribes one.
 */

/**
 * Distinct changes in a run, most decidable first.
 *
 * Leads with the count of *decisions* rather than the count of subjects, and
 * then with the exact command that settles each one — because the failure this
 * tool exists to prevent is not an agent that cannot find the information. It is
 * an agent that finds it, summarises forty subjects into a paragraph, and leaves
 * the operator exactly where they started.
 *
 * The distinction between `subjects` and `settles` is carried into the text on
 * every line, and it is the one thing here that must not be smoothed over: a
 * shape appearing beside something else cannot be accepted there without
 * promoting a difference nobody reviewed. `variance accept --shape` refuses
 * those by name; saying so here means the agent proposes a command that will
 * work rather than one that will be refused.
 */
export const changes: Tool = {
  name: 'variance_changes',
  description:
    'Group this run’s changed subjects into the distinct changes behind them, most ' +
    'decidable first. A design-token edit touching forty stories is one change, not forty. ' +
    'Each names the component responsible, the subjects it reached, the subjects where it is ' +
    'the whole change (and can therefore be settled in one action), and the shape digest to ' +
    'pass to `variance accept --shape`. Ask this before asking about any individual subject.',
  inputSchema: {
    type: 'object',
    properties: {
      component: {
        type: 'string',
        description: 'Optional. Only changes attributed to this component.',
      },
    },
    additionalProperties: false,
  },

  run(report, input) {
    const wanted = typeof input?.['component'] === 'string' ? input['component'] : undefined;

    const changed = report.observations.filter(
      (observation) => observation.verdict === 'changed',
    ).length;

    const clustering = clusterChanges(report.observations);
    const selected =
      wanted === undefined
        ? clustering.changes
        : clustering.changes.filter((change) => change.component === wanted);

    if (wanted !== undefined && selected.length === 0) {
      // Two claims kept apart. "No change was attributed to `Button`" and "this
      // run grouped nothing at all" lead an agent to different next moves, and
      // collapsing them into one sentence sends it down the wrong one.
      return clustering.changes.length === 0
        ? 'This run has no grouped changes at all, so nothing can be attributed to ' +
            `${wanted} or to anything else.`
        : `No change in this run is attributed to ${wanted}. Components with changes: ` +
            named(clustering.changes).join(', ');
    }

    if (selected.length === 0) {
      return clustering.ungrouped.length === 0
        ? describeClustering(clustering, changed)
        : `${describeClustering(clustering, changed)}. Ungrouped subjects have no difference ` +
            'shape, which means the run compared without a document — the ephemeral mode, or a ' +
            `raster-only path: ${clustering.ungrouped.join(', ')}`;
    }

    return [
      wanted === undefined
        ? describeClustering(clustering, changed)
        : `${selected.length} change(s) attributed to ${wanted}`,
      '',
      ...selected.map(render),
      ...(clustering.ungrouped.length > 0 && wanted === undefined
        ? [
            '',
            `Not grouped (${clustering.ungrouped.length}): ${clustering.ungrouped.join(', ')}`,
            '  These carry no difference shape, so the run compared without a document. ' +
              'They have to be reviewed one at a time.',
          ]
        : []),
    ].join('\n');
  },
};

function render(change: Change): string {
  const head = change.component ?? '(grouped by pixel shape; no component resolved)';
  const where = change.file === undefined ? '' : `  ${change.file}\n`;

  const reach =
    change.subjects.length === change.settles.length
      ? `  reaches ${change.subjects.length} subject(s), and is the whole change in all of them\n`
      : `  reaches ${change.subjects.length} subject(s); it is the whole change in ` +
        `${change.settles.length}\n` +
        `  in the other ${change.subjects.length - change.settles.length}, something else ` +
        'also moved, so accepting this shape there would promote a difference nobody reviewed\n';

  // The command, spelled out. An agent that has to derive it will sometimes
  // derive it wrong, and the digest is the one part of this answer that cannot
  // be guessed from anything else in the report.
  const action =
    change.settles.length === 0
      ? '  no subject can be settled by this shape alone\n'
      : `  variance accept --shape ${change.fingerprint}\n`;

  return (
    `${change.cause ? '' : '[collateral] '}${head}\n` +
    where +
    reach +
    `  ${change.pixels} pixel(s): ${preview(change.subjects)}\n` +
    action
  );
}

/** The first few subjects, because a reader wants examples and not a manifest. */
function preview(subjects: readonly string[]): string {
  return subjects.length <= 4
    ? subjects.join(', ')
    : `${subjects.slice(0, 4).join(', ')}, and ${subjects.length - 4} more`;
}

function named(changes: readonly Change[]): readonly string[] {
  return [
    ...new Set(
      changes.map((change) => change.component).filter((name): name is string => name !== undefined),
    ),
  ];
}
