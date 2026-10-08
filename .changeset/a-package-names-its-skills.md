---
"@variance-authority/sense": minor
"@variance-authority/help": minor
"@variance-authority/cli": patch
---

`variance ask stack`, and `docs_stack` on the MCP server, list the agent
skills an installed package ships. A skill is a `skills/<name>/SKILL.md` beside the package's
`package.json`, the layout TanStack Intent set for npm. Each is listed under
its package with its name, the file to read and the first sentence of the
description in its front matter. Nothing is installed or copied: your agent reads the file from
`node_modules`, at the version you installed. A `SKILL.md` deeper inside a
package is not listed.

The dependency lexicon moves to version 9 and records each package's skills.
A lexicon written before this release still answers, and `stack` says that
skills were not read until `variance index` refreshes it.
