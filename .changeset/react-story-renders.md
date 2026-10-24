---
'@variance-authority/react': minor
'@variance-authority/sense': minor
---

A test story now says why each React component rendered. With `@variance-authority/react/story` in the suite's setup files, every commit adds a line per component that rendered, at the step that caused it: `rendered Summary — expanded false → true`, `rendered Cart — useState #0 false → true`, a class's `state`, a context by its display name, `mounted` once at the top of a subtree that mounts, `its parent rendered` when none of its inputs moved, or `state not read past <hook>` where the hook reader stops. Values are shown as handed ones are, objects by their ref. Comparing two tests' stories shows the first render whose cause differs. `tapCommits` takes `onRender`, which hands over each component that rendered while its previous render is still on `fiber.alternate`. The story note channel takes a template — its strings and values — and shows each value as a step shows what it was handed.
