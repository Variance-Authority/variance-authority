---
'@variance-authority/mcp': patch
'@variance-authority/cli': patch
'@variance-authority/help': patch
'@variance-authority/sense': minor
---

The source tree reads the mocks, as `variance covering --since` does

The source tree `readTree` reads, which `variance ask`, the `docs_*` tools and
an MCP host walk, now reads `vi.mock`, `jest.mock` and `sb.mock` calls off what
the parse recorded: a mock subtracts its target from the test file's edges, and
a real module its factory loads adds one. `@variance-authority/sense` exports
`runGraphOf`, the one fold that graph and `variance covering --since` are both
built by: the mocks, then the taints you pass, and the records folded with
their shadows.
