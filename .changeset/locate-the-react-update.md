---
'@variance-authority/react': minor
'@variance-authority/eyes': minor
'@variance-authority/mcp': minor
---

Distinguish the React component instance that initiated a commit from every
component whose render body ran because of it.

The commit tap retains `memoizedUpdaters` as bounded structural component paths,
and Eyes records those commits in the authored test chronology. The MCP testing
surface places update initiators inside or outside the component paths a test
addressed while keeping whole-test source execution separate.

Export bounded read-only Fiber subtree, parent-chain, component-path, and source
location helpers for diagnostics that already hold a Fiber.
