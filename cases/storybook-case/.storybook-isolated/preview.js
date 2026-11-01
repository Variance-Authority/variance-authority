import { nextSession } from '@variance-authority/isolator';
import { addons } from 'storybook/preview-api';

/** The stories that keep the session of the story before them: the leak the reset removes. */
const SHARED = new Set(['isolated-tally--shared-first', 'isolated-tally--shared-second']);

// Storybook imports the next story's file before it tears the last story down
// and runs any loader, so the reset answers the switch itself: the story file,
// every module it loads for the first time, and every loader, decorator, render
// and play function read the session it starts, as on a fresh page.
addons.getChannel().on('setCurrentStory', ({ storyId }) => {
  if (!SHARED.has(storyId)) nextSession();
});

export default {};
