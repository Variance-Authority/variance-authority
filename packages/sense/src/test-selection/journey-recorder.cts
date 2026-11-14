// compass: variance-authority.reach.story
/**
 * What a live head loads to tell a story: the tap and the story format, for
 * [`journey-story.ts`](journey-story.ts).
 *
 * The requests are literal, in CommonJS, so a bundler that packs the head
 * packs them with it, and they run only when a head is asked for stories: a
 * head not asked never loads either. An ES module could not wait like this
 * without `createRequire`, whose requests a bundler leaves to the files beside
 * the bundle, which a bundle does not have.
 */

import type storyTap = require('../instrument/story-tap.cjs');
import type storyFormat = require('../story/format.cjs');

/** The tap and the format, loaded on the first call. */
function loadRecorder(): { storyTap: typeof storyTap; storyFormat: typeof storyFormat } {
  return { storyTap: require('../instrument/story-tap.cjs'), storyFormat: require('../story/format.cjs') };
}

export = { loadRecorder };
