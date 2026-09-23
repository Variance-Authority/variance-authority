---
'@variance-authority/sense': patch
---

Coverage from two builds that divide a file into different regions is recorded against the regions both have

Two transforms of the same source can divide it into regions differently, so a
region number from one build names a different region in the other.
`variance journeys stitch` refused such shards, and folding them recorded
coverage against the wrong region. Now a region that only one build has is
recorded against the smallest containing region that every build has, or
against the whole file when there is none. A changed line there selects every
test that ran the containing region: the selection is wider, and it does not
miss a test. `variance journeys finalize` and `stitch` print the files this
applies to.
