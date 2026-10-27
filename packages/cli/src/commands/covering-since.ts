// compass: variance-authority.reach
/**
 * `variance covering --since`: the lines a diff changed, in the record's
 * coordinates, and each changed region stated over every case that reached it.
 */

import { realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { changedLines, type CoveringRegion, type LineRange } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { regionState } from './covering-frame.js';
import { diffSince } from './since.js';
import type { StatedRegion } from './covering.js';

/** A changed region as `--where` lists it, stated, with the cases that stopped, over every case that reached it. */
export function stated(listed: CoveringRegion, reached: CoveringRegion): StatedRegion {
  const { stopped: _, ...region } = listed;
  const state = regionState(reached);
  return {
    ...region,
    ...(reached.stopped === undefined ? {} : { stopped: reached.stopped }),
    ...(state === undefined ? {} : { state }),
  };
}

/**
 * Every line a diff changed, in the index's coordinates.
 *
 * The diff is measured from the commit the record was written at, when it has
 * one, rather than from the merge base with `ref`, because the index's line ranges are in that
 * commit's coordinates and nothing else's. The two part company as soon as the
 * branch moves under the recording, and a hunk read at the wrong end lands on
 * lines the index numbered for a different region — which is the one failure
 * here nobody can see, since a wrong list of test names reads exactly like a
 * right one.
 *
 * `git` names files from the repository root and the index names them from the
 * run's, so the paths are brought into the index's coordinates before anything
 * is looked up. Unmatched paths are reported rather than dropped: an answer that
 * silently left out half a diff is worse than one that says it cannot speak to
 * it.
 */
export async function changeSince(
  since: string,
  root: string,
  at: string | undefined,
): Promise<ReadonlyMap<string, readonly LineRange[]>> {
  const diff = await diffSince(since, [], at);
  if (diff === undefined) {
    throw new OperatorError(
      `\`--since ${since}\` could not be read as a diff. Check the ref exists and that this is a ` +
        'git checkout; an empty answer here would read as `your change touches nothing`.',
    );
  }

  // The working directory is always a real path and `--root` is spelled however
  // the caller spelled it; through a symlink (`/var` on macOS) the two never meet.
  const here = process.cwd();
  const base = await realpath(root);
  const changed = new Map<string, readonly LineRange[]>();
  for (const [file, ranges] of changedLines(diff)) {
    changed.set(here === base ? file : relative(base, resolve(here, file)), ranges);
  }
  if (changed.size === 0) {
    throw new OperatorError(
      `nothing has changed since \`${since}\`, so there is no region to ask about.`,
    );
  }
  return changed;
}
