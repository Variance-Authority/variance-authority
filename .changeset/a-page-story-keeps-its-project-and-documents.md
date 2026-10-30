---
'@variance-authority/playwright-test': minor
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

A page story keeps its project, its documents and what it lost

A Playwright case run under two projects writes a story for each, and `variance story` lists each with its project; `--project <name>` reads one, and a comparison refuses a case that ran under two until it names one. A story of a case that ran in more than one page document marks where the route moves into each, its refs are each document's own, and `--compare` no longer counts as a difference the order two documents' work arrived in under one test line. A page closed or replaced before what it ran was read is said in the header, rather than read as a complete story.
