---
'@variance-authority/help': minor
'@variance-authority/sense': minor
---

The documented surface is read off the index by one native producer

Every publish of the questions — `variance index`, a first reading with nothing
published, a reading with `--changed-file` or taints — now reads the names each
entry hands out, the kinds they are declared as and the text of each
declaration from the source index, in the native addon, beside the uses and
the source tree. No parse row crosses into JavaScript, and the checkout is no
longer scanned a second time when nothing was published before. An index that
did not move still publishes nothing.

A reading now always saves the index it scanned, because the value is read from
it: `readWorkspace` drops its `save` and `saveIndex` options, and an index that
cannot be saved is thrown as an `UnsavedRead` rather than answered from memory.
`refreshWorkspace` reads the whole value again from the updated index instead
of keeping the signatures and comments of the reading it was handed.
`@variance-authority/sense` drops `sourceTreeOf` and `forwardsDigest`, and
`readHelp` takes the entries to document and whether to draw the tree; the
reading it returns hands over `names()` and encodes the store with `encode()`.
The unreadable files are listed as the manifests' first, then the index's, each
in path order.
