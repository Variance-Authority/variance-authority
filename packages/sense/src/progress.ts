/**
 * What a long step tells the person waiting on it.
 *
 * An update of a large checkout spends seconds in one git call and tens of
 * seconds in one native read, and both are silent. The step that is running is
 * the one thing the person waiting can use: it says the process is alive, and it
 * says which part of the work is slow. So each step is named when it starts, and
 * the call it returns says it ended. Steps can overlap, because the follow-ups
 * of `variance index` run at once; the caller decides how to show that.
 */

// compass: variance-authority.reach.source-index

import { join } from 'node:path';

/** Told that `step` started; call what it returns when the step ends. */
export type Progress = (step: string) => () => void;

/** `work` as one step of `progress`, ended whether it returns or throws. */
export async function stepped<T>(progress: Progress | undefined, step: string, work: () => Promise<T> | T): Promise<T> {
  const ended = progress?.(step);
  try {
    return await work();
  } finally {
    ended?.();
  }
}

/**
 * Where a step reads, as one line can say it: the directory, or how many
 * directories under the root. A workspace's member list can name two thousand
 * directories, and a step line that names each one is a wall, not a step.
 */
export function placesOf(root: string, dirs: readonly string[]): string {
  return dirs.length === 1 ? join(root, dirs[0]!) : `${dirs.length.toLocaleString('en-US')} directories under ${root}`;
}
