---
'@variance-authority/sense': minor
---

Record Jest journey coverage after the test run

Sense seals each Jest shard's per-test region journals before Jest exits. The
`sense-journeys finalize` command folds one shard into a compressed artifact,
and `sense-journeys stitch` combines downloaded shard artifacts on another
machine. Both commands process the crossing relation in the native addon and
write the result without transferring artifact bytes through the JavaScript
heap.
