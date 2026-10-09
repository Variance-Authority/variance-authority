---
'@variance-authority/tribunal': minor
'@variance-authority/cli': minor
'@variance-authority/mcp': minor
---

The share token reads what review settled, and never decides

A Tribunal deployment now serves `GET /review/changelog` and the new
`GET /review/decisions` to the share token as well as the review token, and
refuses the ingest token there with 403. Every route that decides still wants
the review token. The deployment's API is 4. A share token you already handed
out reads reviewer names and notes once you redeploy.

`variance changelog` on a `remote` store reads the deployment's changelog with
the share token instead of refusing; `--since` takes an instant there.
`variance ask decisions` and the MCP tool `variance_decisions` on
`variance serve` list the approvals and rejections on a subject or a build,
newest first, with who made each and their note. Declare the share token as `{ "env": "VARIANCE_SHARE_TOKEN" }`.
