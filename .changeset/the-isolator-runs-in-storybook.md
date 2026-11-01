---
'@variance-authority/isolator': minor
---

The Vite plugin runs under Vite alone, as in Storybook: it takes its root from Vite's resolved config and rewrites every module but the ones `exclude` names. With `nextSession()` called on Storybook's `setCurrentStory`, before the next story's file is imported, each story switched to on one preview page reads its modules as a page of its own would. The README's "Run it in Storybook" has the setup.
