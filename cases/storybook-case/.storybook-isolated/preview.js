import { isolateGlobals, isolateListeners, isolateTimers, nextSession } from '@variance-authority/isolator';
import { createRoot } from 'react-dom/client';
import { addons } from 'storybook/preview-api';

/** The stories that keep the session of the story before them: the leak the reset removes. */
const SHARED = new Set(['isolated-tally--shared-first', 'isolated-tally--shared-second']);

// What a story leaves on the page outside its modules: its timers, its
// listeners and what it adds to `window` end with it.
isolateTimers();
isolateListeners();
isolateGlobals();

// React listens on the canvas once: a root made at boot adds those listeners
// here, where every story keeps them, not in the first story.
createRoot(document.getElementById('storybook-root')).unmount();

// The reset answers the selection, before Storybook imports the story's file,
// and the story the URL opens is selected too.
addons.getChannel().on('currentStoryWasSet', ({ storyId }) => {
  if (!SHARED.has(storyId)) nextSession();
});

export default {};
