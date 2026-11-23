---
'@variance-authority/help': minor
'@variance-authority/cli': minor
'@variance-authority/mcp': minor
'@variance-authority/sense': minor
'@variance-authority/eyes': minor
---

`variance ask test-claims` (`docs_test_claims`) holds one test against what it
says. It lists its claims, which are its name and, when the run kept an Eyes
journal, the steps and assertions it made in order. It then lists the
functions it ran, with structure counted apart, and what it adds: the tests
that ran exactly the same regions, its pieces and wholes, and the regions only
it enters. Last come the branches of the functions it entered that it did not
take, each with whether another test takes it. It runs nothing and reads no
source.

The `variance-testing` skill gains the step that uses it: judge each claim in a
test's name against what it ran, then choose one of five actions, from `keep` to
`delete`.

`recordedSteps` from `@variance-authority/mcp/tools` reads one recorded test's
steps and assertions from a record, in the same form `variance_test_attention`
prints them. Each suite `testsRan` returns now names the `recording` it was read
from. `createEyesArchive` is exported from `@variance-authority/eyes/archive`
too, for a reader that has no use for the root's React tap.
