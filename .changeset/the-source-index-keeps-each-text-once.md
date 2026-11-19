---
'@variance-authority/sense': patch
---

The source index keeps each signature, doc and line once, however many declarations name it. A checkout that holds minified bundles, whose one line every declaration on it named, gets an index a fraction of the size: on Firefox a segment falls from about 2 GB to about 0.35 GB. The source-index format version moves, so an index or stored parse an earlier release wrote is rebuilt.
