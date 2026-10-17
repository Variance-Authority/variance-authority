---
'@variance-authority/cli': minor
---

A second skill, `variance-testing`, for writing, fixing and debugging tests

`@variance-authority/cli` now ships `skills/variance-testing` beside
`skills/variance-authority`. It gives an agent the order to ask the record in
while it works on tests: `covering` for the tests that stand on a line before
an edit, the `VARIANCE_AUTHORITY_SINCE` legs after it, a story of one failing
test and `--compare outcome` or `--compare alone,file` when it fails only
sometimes, a `console.log` in the code under test when the question is a value,
`covering --since` for what a change left untested, `covering --file` for what a
file's tests leave `unwalked`, `loaded` or `alone`, and `distill` with one
reversible substitution at a time to make a test smaller. It links the
`variance-authority` references for flags, so link both into your agent's
skills directory:

```bash
mkdir -p .agents/skills && for s in variance-authority variance-testing; do ln -s ../../node_modules/@variance-authority/cli/skills/$s .agents/skills/$s; done
mkdir -p .claude/skills && for s in variance-authority variance-testing; do ln -s ../../.agents/skills/$s .claude/skills/$s; done
```

`variance doctor` lists it with the other, and prints the link when your agent
cannot find it.
