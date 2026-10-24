---
'@variance-authority/react': minor
---

A test story now says why each React component rendered. With `@variance-authority/react/story` in the suite's setup files, every commit adds a line per component that rendered, at the step that caused it: `rendered Summary — expanded false → true`, `rendered Cart — useState #0 false → true`, a context by its display name, `mounted`, or `its parent rendered` when none of its inputs moved. Comparing two tests' stories shows the first render whose cause differs. `tapCommits` takes `onRender`, which hands over each component that rendered while its previous render is still on `fiber.alternate`.
