/**
 * `@variance-authority/storybook` — a project's own Storybook as the subject list.
 *
 * Three steps, kept apart because they fail differently and are worth testing
 * separately (spec 0006):
 *
 * 1. {@link readStoryIndex} reads what a built Storybook declares, and refuses
 *    anything that is not that. No browser, no evaluation, no `.storybook/`.
 * 2. {@link toSubjects} turns those entries into subjects and applies policy —
 *    exclusion, viewport, and a deterministic order. Pure.
 * 3. {@link collectStory} drives a preview page that is already open, moving
 *    between stories over Storybook's own channel rather than reloading.
 *
 * The seam between 2 and 3 is where this package stops: capture belongs to the
 * collector and the harness, which know nothing about Storybook and must keep it
 * that way. What is handed across is a subject id, a URL, and the fact that the
 * story is ready — plus, when it is not, the reason.
 *
 * Nothing here prunes Storybook's chrome. It does not have to: the story mounts
 * into `#storybook-root`, so the preview reset, the addon layout, and the error
 * overlay are outside the subject subtree and are dropped by ordinary CSS
 * applicability pruning (ADR-0003). A Storybook-specific denylist would be a
 * second normalization ruleset, versioned by nobody.
 */

export { parseStoryIndex, readStoryIndex } from './index-file.js';
export type { StoryEntry, ExcludedEntry, StoryIndex, IndexShape } from './index-file.js';

export { toSubjects, storySubjectId } from './subjects.js';
export type {
  StoryParameters,
  StoryViewport,
  SubjectOptions,
  StorySubject,
  ExcludedStory,
  SubjectPlan,
} from './subjects.js';

export {
  PREVIEW_PATH,
  STORY_ROOT_SELECTORS,
  STORYBOOK_EVENTS,
  STORYBOOK_ERROR_OVERLAY,
  previewUrl,
  showStory,
  harnessPage,
  collectStory,
  collectStories,
} from './preview.js';
export type {
  ShowEvents,
  ErrorOverlay,
  ShowRequest,
  ShowStatus,
  Readiness,
  ShowResult,
  StoryPage,
  CollectOptions,
  CollectManyOptions,
  StoryOutcome,
  StoryError,
} from './preview.js';
