---
'@variance-authority/cli': patch
'@variance-authority/mcp': patch
'@variance-authority/tribunal': patch
---

An excluded subject is reported as excluded on purpose

The pull request comment, the MCP summary and the tribunal's coverage line
said "excluded by configuration". A subject is also excluded by a story's tags
or by a page's own `data-variance-exclude`, so they now say "excluded on
purpose", and the run report keeps each exclusion's reason.
