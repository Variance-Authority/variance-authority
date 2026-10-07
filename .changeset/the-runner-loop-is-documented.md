---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

The README leads with the runner selecting itself, and the skill shows the edit loop

`@variance-authority/sense`'s README now opens with a wrapped Vitest or Jest
run that leaves out what a diff cannot reach once `VARIANCE_AUTHORITY_SINCE` is
set, and the selection API follows as the way to ask for the skip list
yourself. Its retirement paragraph describes how a run over an edited module
reads the edit from both texts, rather than marking every test that ran it.

The `variance-authority` skill's test-selection reference adds the loop an agent
runs after each edit, nearest tests first, and says that a wrapped runner
resolves `@variance-authority/cli` from the project.
