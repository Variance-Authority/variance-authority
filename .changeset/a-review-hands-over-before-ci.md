---
"@variance-authority/cli": minor
---

`variance review --format handover` prints breadcrumbs to the coverage of a
change's area as one collapsed block for the pull request body, read from the
record this checkout already has. A review bot reads the body when the pull
request opens, before CI has finished. It gets a line for each changed
function no case reached, the change wrote, or a case reached only from far,
those no case reached first, with the test file to open; functions reached from
near are counted. Past twelve lines the rest are counted, and the block ends
with the `variance covering` command for one file. Markers around the block let
a later run replace it.
