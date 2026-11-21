# Follow a golden path

When the task is an outcome rather than one question, its golden path on the
site owns the order of the steps and links the page for each; it describes the
latest release. Below, each path names the references that cover its steps.

- **Make CI faster** ([path](https://variance-authority.dev/docs/path-faster-ci)):
  shard by recorded time ([combine CI shard records](test-selection.md#combine-ci-shard-records)),
  select on a pull request ([selection wiring](selection-wiring.md)),
  carry the record to the next push (the same reference), then
  [test an edit in a loop](test-selection.md#test-an-edit-in-a-loop).
  All four start from the record main publishes.
- **Review a visual change** ([path](https://variance-authority.dev/docs/path-visual-review)):
  [check an edit](check-an-edit.md), then [ask a run](ask-a-run.md).
- **Review a pull request** ([path](https://variance-authority.dev/docs/path-code-review)):
  the handover, then [covering](covering.md) for a function it flags
  🔴 and [the whole change](covering.md#ask-about-the-whole-change-at-review-time),
  then `variance layers`, then `review --fail-on-uncovered` or `--fail-on-lost` as the [gate](../SKILL.md#what-each-command-needs).
- **Keep a test suite lean** ([path](https://variance-authority.dev/docs/path-lean-suite)):
  [covering](covering.md), then
  [case preconditions](case-preconditions.md), then
  [distill](distill.md).
- **Orient a coding agent in a codebase** ([path](https://variance-authority.dev/docs/path-agent-orientation)):
  for a concrete feature task, start with [coding start points](code-orientation.md).
  For the architecture, use [orient](orient.md#orient),
  [stack](orient.md#stack), [packages](workspace-api.md#packages)
  and `variance layers` as needed. Before editing, ask
  [covering](covering.md) about the lines to change.
- **Find out why a test failed or hangs** ([path](https://variance-authority.dev/docs/path-test-failure)):
  [story](story.md) from the wrapped suite's record (a visual run
  starts at [ask a run](ask-a-run.md)), then where it [parted from a passing test](https://variance-authority.dev/docs/journeys);
  a run that has not ended starts at [live run](live-run.md), then
  [interrogate the test](https://variance-authority.dev/agents/interrogate).
