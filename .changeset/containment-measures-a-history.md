---
'@variance-authority/cli': minor
'@variance-authority/help': minor
'@variance-authority/package': minor
'@variance-authority/sense': minor
---

`variance ask containment` counts how far the commits of a window reached across
package boundaries: the share that touched one package, and the share that
edited a test in another package or in a test-only tree. Each figure is a count
over its denominator, and `--format json` holds them all. MCP clients get the
same answer as `docs_containment`.
