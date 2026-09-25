---
'@variance-authority/sense': patch
---

A project's configuration governs its own tests. In a Vitest run with `projects`, a project's config file, the local modules it imports and its setup files are preconditions of that project's tests only, and the setup files are resolved against the project's own root, so one named relative to it is declared rather than missed. Jest reads each test's setup and environment files from the project it ran under, and Rstest keeps a named project's setup files for its own tests. The configuration that lists the projects stays a precondition of every test, and a test whose project the runner does not name rests on every project's files.
