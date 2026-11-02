import { isolateGlobals, isolateTimers, nextSession } from '@variance-authority/isolator';
import { addons } from 'storybook/preview-api';

/** The stories that keep the session of the story before them: the leak the reset removes. */
const SHARED = new Set(['isolated-tally--shared-first', 'isolated-tally--shared-second']);

// What a story leaves on the page outside its modules: its timers and what it
// adds to `window` end with it.
isolateTimers();
isolateGlobals();

// The reset answers the selection, before Storybook imports the story's file,
// and the story the URL opens is selected too.
addons.getChannel().on('currentStoryWasSet', ({ storyId }) => {
  if (!SHARED.has(storyId)) nextSession();
});

export default {};
