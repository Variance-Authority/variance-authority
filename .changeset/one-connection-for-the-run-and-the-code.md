---
'@variance-authority/mcp': minor
'@variance-authority/cli': minor
'@variance-authority/help': patch
---

One connection answers about the run and about the code

`variance serve` served the report tools and nothing else. An agent in a
workspace that already had the CLI still had to configure
`variance-authority-help` as a second MCP server to ask what a package
publishes or where a name is declared — and that second server was the only
place a start point could be said at all, because `serve` passed no checkout
root, so `from` and `to` were refused over the transport the workspace was
already using. The six source questions had been on `variance ask` since the
fold began; the fold stopped at the shell.

Both tool sets now mount over one composite subject, so `tools/list` on
`variance serve` returns the twelve questions about the run and the six about
the source, and the six read the checkout the server was started in. Which
half is read is decided by the question: a report is a file and is re-read on
every request, a workspace reading is a scan and happens only when one of the
six is what was asked, so a connection that never asks about the source never
pays for one.

Two options on `serve` in `@variance-authority/mcp` carry that, and are useful
to anyone hosting these tools over more than one subject. `subject` is now
handed the name of the tool a request calls, where it calls one, so a host can
read only the half the question needs. `remember` says what is worth keeping
for the next request, in place of the default structured clone of the whole
subject: the one tool that compares this request with the last one compares
reports, and cloning a whole workspace reading on every successful call would
buy that comparison nothing.

`@variance-authority/help` is unchanged as a package. What changed is what its
pages say: a workspace that has the CLI needs nothing from it over either
transport, and the standalone binary is for the workspace that runs no visual
suite.
