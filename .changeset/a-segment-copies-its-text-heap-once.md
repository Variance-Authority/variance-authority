---
'@variance-authority/sense': patch
---

A cold index holds about 2.4 GB less while it encodes a large tree, and encodes faster. The text heap that signatures, docs and line texts are written into is kept in the parts its runs wrote and copied once, into the segment, instead of being joined into one buffer and copied again. Each part is freed as soon as it is copied, so the segment and its columns are never both held whole. The bytes written are unchanged.
