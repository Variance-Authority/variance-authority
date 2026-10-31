---
'@variance-authority/isolator': patch
---

The isolator runs in Vitest. `@variance-authority/isolator/transform` exports `skipper(root, exclude)`, the answer the Jest transformer and the loader already give for which files stay as they are — anything under `node_modules`, what `sideEffects` lists, and the `exclude` globs — so a Vite plugin of a dozen lines, which the README gives, rewrites what they rewrite. Under `isolate: false` every test then reads the values its modules were loaded with, while the worker keeps them loaded across files. A file that mocks or renders into a DOM needs its modules loaded after what it does first, so the README's config keeps those files in an isolated project.
