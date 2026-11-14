// compass: variance-authority.reach.story
/**
 * Whether a process was asked for stories, read by a test run and a live head
 * alike, and by neither through anything heavier than the environment.
 */

/** Set to `1`, or to a label, to write a story for every case the run runs. */
export const STORY_VARIABLE = 'VARIANCE_AUTHORITY_STORY';

/** Whether the environment asks for stories: unset, empty and `0` do not. */
export function storiesAsked(environment: NodeJS.ProcessEnv = process.env): boolean {
  const asked = environment[STORY_VARIABLE];
  return asked !== undefined && asked !== '' && asked !== '0';
}
