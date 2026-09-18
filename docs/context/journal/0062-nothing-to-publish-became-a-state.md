# Nothing to publish became a state

**Date:** 2026-09-18

An unchanged source-index save wrote no bytes but still spent about 360 ms
proving that it should write no bytes. It constructed differences over every
parse, record and directory, then found all three empty.

The source-index session now records whether adopting the tree, setting a parse
or setting a record changed the opened generation. A clean session whose scan
accounted for every reusable record returns before constructing the differences.
The complete comparison remains the fallback for a partial scan, a changed
shape, a changed parse or a changed record.

The reproduction is the unchanged row of the source-index benchmark:

```bash
yarn build
TARGET_REPOSITORY=/absolute/path/to/a/clean/frontend-repository
node packages/sense/scripts/source-index.mjs "$TARGET_REPOSITORY" jira
```

Against a freshly built 183,365-record index on the same checkout:

```text
                         before       after
unchanged publish       357.852 ms    0.040 ms

three further unchanged publishes
  before                708.806 ms  471.011 ms  381.367 ms
  after                   0.045 ms    0.006 ms    0.005 ms
```

The spread in the old path came from walking and comparing repository-sized
maps, not from storage: both versions write nothing. The new path makes that
fact explicit at the operations capable of changing the generation. A changed
configuration, parse or record, a native parse layer, or a scan that did not
account for every reusable record still takes the complete comparison and
publication path.
