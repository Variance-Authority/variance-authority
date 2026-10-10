---
'@variance-authority/cli': minor
'@variance-authority/mcp': minor
---

The share token reads what reviewers flagged, and why

`variance ask concerns` and the MCP tool `variance_concerns` on `variance serve`
list the concerns reviewers raised on a render: the title, the state (open,
investigating or resolved), the region and component it is about, what the
reviewer pointed at, and every step since with its note and hypothesis.
`--subject` or `--build` names which; `--build` reads the concerns on every
subject the build showed, whichever build raised them, and counts them by state;
`--state` keeps one state. It reads the same deployment with the same share token
as `variance ask decisions`, and raises, moves or resolves nothing.

Every tool in `REVIEW_TOOLS` is a `ReviewTool`, naming the route its subject is
read from and the query a call sends there, so a host reads each one the same way.
