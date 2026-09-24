---
'@variance-authority/sense': patch
---

A region that a transform writes with no source-map origin is now recorded with
no lines. Before, it was given the line it had in the generated text. The main
case is the helpers esbuild writes above the first line of a module with a
decorator, which landed on the lines below them. An edit to a function after a
decorated class then selected the test that ran the helpers instead of the test
that called the function. Selection, `covering` and journeys skip a region with
no lines. A module recorded before this change keeps the old lines until a run
records it again.
