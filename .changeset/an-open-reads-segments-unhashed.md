---
'@variance-authority/sense': patch
---

Opening the source index no longer hashes every segment: a segment is checked
against the length its manifest names, and the digest is computed once, when it
is written. On Kibana this takes about 60 ms off every question. The writer now
syncs each segment, the segments' directory and the manifest to disk before the
rename that publishes them, so a power loss cannot leave a manifest naming bytes
the disk did not keep.
