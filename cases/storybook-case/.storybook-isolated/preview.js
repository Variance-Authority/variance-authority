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

// React listens on the canvas once, and marks it: listeners the first story's
// render added would end with that story while the mark stayed, and no click
// would reach the next one. A root made and unmounted at boot adds them here,
// where every story keeps them.
createRoot(document.getElementById('storybook-root')).unmount();

// Storybook imports the next story's file before it tears the last story down
// and runs any loader, so the reset answers the selection itself: the story
// file, every module it loads for the first time, and every loader, decorator,
// render and play function read the session it starts, as on a fresh page. A
// story chosen by the URL is selected too, so the first story does not run in
// the boot's session, whose writes every story keeps.
addons.getChannel().on('currentStoryWasSet', ({ storyId }) => {
  if (!SHARED.has(storyId)) nextSession();
});

export default {};
