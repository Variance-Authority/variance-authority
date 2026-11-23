---
'@variance-authority/eyes': patch
'@variance-authority/mcp': patch
---

Record a Playwright assertion made through `.not` as `negated: true`. Before,
`expect(locator).not.toBeEmpty()` was journaled as `to.be.empty`, the opposite
of what the test asserted. The archive accepts `negated: true` and refuses any
other value, and both the story note and `variance_test_attention` print the
matcher as `not.to.be.empty`.
