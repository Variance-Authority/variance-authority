/**
 * Where stories go, and whether a run asked for them.
 *
 * One variable on the command line, read by every seam when it configures the
 * run: `VARIANCE_AUTHORITY_STORY=1` tapes every case the run runs, and
 * narrowing is the runner's job — `-t`, a file argument, whatever the runner
 * already has. A story is written for somebody reading one case, so a run
 * without the variable pays nothing for it.
 *
 * The directory is this checkout's own cache layer, beside the recording and
 * out of git. A worktree writes its own and never reads the primary
 * checkout's: a story is the last run of a case here, and one from another
 * checkout is a run of other code.
 */

import { resolve } from 'node:path';
import { repositoryLayers } from '../test-selection/cache-layers.js';

/** Set to `1` to write a story for every case the run runs. */
export const STORY_VARIABLE = 'VARIANCE_AUTHORITY_STORY';

/** This checkout's story directory, whether or not anything has been written there. */
export function storyDirectory(root: string): string {
  return resolve(repositoryLayers(root).top, 'story');
}

/** The story directory when the environment asks for stories. */
export function askedForStories(root: string, environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const asked = environment[STORY_VARIABLE];
  return asked === undefined || asked === '' || asked === '0' ? undefined : storyDirectory(root);
}
