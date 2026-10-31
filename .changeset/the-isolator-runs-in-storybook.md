---
'@variance-authority/isolator': minor
---

The Vite plugin runs under Vite alone, as in Storybook: it takes its root from Vite's resolved config and rewrites every module but the ones `exclude` names. With `nextSession()` as the first project loader, each story switched to on one preview page starts from the values its modules were loaded with. The README's "Run it in Storybook" has the setup.
