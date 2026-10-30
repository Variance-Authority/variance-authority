// compass: variance-authority.reach.story
/**
 * Stories: the order one case went through the code, taped under
 * `VARIANCE_AUTHORITY_STORY`, read back as a route, and compared reading
 * against reading.
 */

export { askedForStories, storyDirectories, storyDirectory, STORY_VARIABLE } from './directory.js';
export { foldSteps, PERIOD, type Step } from './fold.js';
export { compareOutcomes, recordedReadings, type Charge, type Moved, type OutcomeComparison, type OutcomeRegion, type RecordedCase } from './outcomes.js';
export { compareReadings, type Comparison, type Moment, type Only, type Order, type PlaceDifference, type Side, type SideSummary } from './compare.js';
export { drawRoute, listStories, readRoute, type Arm, type Place, type Region, type Route, type Stop, type StoryEntry, type Untaken } from './read.js';
