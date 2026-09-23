---
'@variance-authority/storybook-collector': patch
---

A story file is recorded under its path in the repository

Storybook writes each story's `importPath` relative to the directory it ran
in, with a `./` in front. The recorder resolved that path against the
repository root. In a workspace, where Storybook runs in a package directory,
this had two effects: the story file's precondition read a file that does not
exist and was dropped without a message, and the per-story index named a path
no diff contains. So a commit that edited only a `.stories` file selected none
of its stories.

The recorder now resolves `importPath` from `tests.root`, which defaults to the
current directory, and records the path relative to the repository root.
