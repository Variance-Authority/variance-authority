/**
 * What the reporter tells every Playwright worker before it forks: where to
 * publish journals, and what to name test files against. Not an entrypoint —
 * the reporter and the fixture are the only two parties to it.
 */

/**
 * The variable a run names its journal directory in, for the workers it forks.
 *
 * A worker inherits the environment as it stood when it started and has no
 * other way to be told, so the reporter sets this before the first fork and the
 * fixture reads it at every test's teardown.
 */
export const EYES_STAGE_VARIABLE = 'VARIANCE_EYES_STAGE';

/**
 * The checkout a run's test files are named against, set beside the stage.
 *
 * A journal names its test file the way Sense names the same file, relative to
 * the repository, so the two join. Git answers where that is once, in the
 * reporter, and every worker is handed the answer rather than asking again.
 */
export const EYES_ROOT_VARIABLE = 'VARIANCE_EYES_ROOT';

/** Where this run publishes journals, and what it names files against, when a run named them. */
export function eyesStage(): { readonly directory: string; readonly root: string } | undefined {
  const directory = process.env[EYES_STAGE_VARIABLE];
  const root = process.env[EYES_ROOT_VARIABLE];
  if (directory === undefined || directory === '' || root === undefined || root === '') {
    return undefined;
  }
  return { directory, root };
}
