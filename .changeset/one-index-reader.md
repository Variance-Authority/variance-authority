---
'@variance-authority/sense': patch
---

The source index is read by the native addon alone, and a row of it is decoded only when a caller asks for that row.

Reading the index now needs the addon, as writing it already did: without it, a read fails and names why the addon did not load.

A segment is checked whole when it is opened, so an index that read before may now be found damaged. On a workstation it is updated from the segments that read; in CI the step that publishes it runs again.
