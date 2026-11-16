---
'@variance-authority/sense': patch
---

Opening the source index no longer hashes every segment: a segment is checked
against the length its manifest names, and the digest is computed once, when it
is written. On Kibana an open falls from 79 ms to 24; a question that
refreshes the index pays about 14 ms of that back in syncs. The writer now
syncs each segment, the segments' directory and the manifest to disk before the
rename that publishes them, so a power loss cannot leave a manifest naming bytes
the disk did not keep.
A segment of the right length whose bytes were damaged is refused with an error
naming the index, never a crash of the process, and the next update rebuilds it.
