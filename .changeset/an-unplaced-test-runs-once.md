---
'@variance-authority/sense': patch
---

`atDistance` returns a test with no measured hop count with the one range that
holds the furthest hop the reading measured, or with an open range such as `3-`
when nothing was measured. Ranges that cover every hop without overlapping, such
as `0-2` and `3-`, return each such test once. Before, every range whose top was
at or past the furthest hop returned it, so when nothing was measured beyond two
hops both `0-2` and `3-` did. A caller that runs only an open range starting
past the furthest hop, such as `3-` when the furthest is 2, now gets none of
them; `remaining` follows `atDistance`. The signature is unchanged.
