/**
 * The narrowing coordinate, as the one line a summary header gives it.
 *
 * Beside [`summary.ts`](./summary.ts) rather than inside it because it answers a
 * different question from every other line in that header. The rest of the
 * header reports what the run found; this reports what the run did not do and
 * could have, which is a fact about the operator's options and not about the
 * suite.
 */

import type { RunReport } from '@variance-authority/report';

/**
 * What this run narrowed by, in the header rather than in a section.
 *
 * Narrowing is an option and stays one — nothing here proposes that a run should
 * have skipped anything. What it refuses is the state where an agent works
 * against this suite for weeks without ever learning that an index is on disk,
 * that the index knows the commit it stands at, and that the distance from there
 * is a number. An option nobody is told about is an option nobody has.
 *
 * So the coordinate is printed and the command is spelled out, and both are
 * omitted the moment there is nothing to offer: no index, or an index the tree
 * has not moved from, and the line would be an invitation to spend a call
 * learning that zero files changed.
 */
export function narrowing(report: RunReport): readonly string[] {
  const state = report.narrowing;
  if (state === undefined) return [];
  if (state.since !== undefined) return [`narrowed from ${state.since}`];
  if (state.index === undefined || state.index.changed === 0) return [];
  return [
    `observed everything — the execution index stands at ${state.index.commit}, ` +
      `${state.index.changed} file(s) differ from it; ` +
      `\`variance run --since ${state.index.commit}\` observes only what those reach`,
  ];
}
