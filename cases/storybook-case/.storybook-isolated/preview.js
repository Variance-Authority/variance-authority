import { nextSession } from '@variance-authority/isolator';

export default {
  // Storybook runs a story's loaders before its `beforeEach`, so the reset is
  // the first loader: every loader, decorator, render and play function of the
  // story reads the session it starts. A story that sets `sharedModules` keeps
  // the session of the story before it, which is the leak the reset removes.
  loaders: [({ parameters }) => (parameters.sharedModules === true ? {} : (nextSession(), {}))],
};
