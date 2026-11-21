---
'@variance-authority/sense': minor
---

`checked(id, fn)` ships from `@variance-authority/sense/checked`: a case under Vitest, Jest, Rstest or Playwright runs the check it is there for under an id, and the run records which declared checks each attempt entered. What a case declares is read from its test file before the run — each literal-id `checked` call in its body, and in a helper of the same file the body calls, at the line the body calls it; an id built at run time declares nothing. A test file where the runner did not end an attempt it began is kept as incomplete. `ChecksScope`, `CheckedAttempt` and `recordChecks` are gone from `./journal`; `EnteredCheck` replaces them.
