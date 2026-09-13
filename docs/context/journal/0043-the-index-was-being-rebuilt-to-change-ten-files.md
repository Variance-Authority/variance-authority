# 0043 — the index was being rebuilt to change ten files

[Journal 0041](0041-what-a-rewrite-would-buy.md) measured where `sense`'s
milliseconds are and named the largest number on the board without doing
anything about it: at twenty thousand modules a run ends with a
read-modify-write that costs about two and a quarter seconds, and almost none of
it is work the run asked for.

The shape is the same every time. A build re-records the files it loaded —
ten, of two hundred thousand — and the index holds everything else. The write
seam decoded the whole snapshot into a model, merged ten modules into it, and
encoded the model back. Six hundred thousand region objects were built and
immediately serialized into the bytes they came out of. That is 99.995% of the
index materialized to arrive at itself.

## What changed

`layerTestCoverage` in
[`format-layer.ts`](../../../packages/sense/src/test-selection/format-layer.ts)
is the decode, the merge and the encode as one pass over the columns the
previous snapshot is already stored in. A module the run did not touch is never
made an object: its rows are copied column to column as integers, its strings
are copied blob to blob as bytes, and the only thing that happens to either is
the renumbering the new dictionary implies. Objects are built for exactly what
the merge reasons about — the tests, the modules `current` re-recorded, and the
carried modules whose text moved on disk.

Two things made that possible, and both are in the format rather than in this
file. The dictionary is sorted, so the strings the output keeps are already in
order and the new dictionary is a merge of two ordered runs — the dominant run
compared and copied as bytes, never decoded. And the snapshot opens by parsing
its section index and nothing else, so the columns a layer never reads are never
decompressed.

## The reproduction

```bash
yarn workspace @variance-authority/sense build
```

```bash
node packages/sense/scripts/native.mjs 20000
```

```
20,000 modules, 665,194 regions, a run that re-recorded 10 of them

  decode, merge and encode     2079 ms      1024 ms ours   596 ms brotli
  the same, over the columns    808 ms       298 ms ours   410 ms brotli
                               ——————
                                 2.6x, byte for byte the same file
```

Cold, as a run pays it, the ratio is 2.2x — 2237 ms to 1039 ms. The number
worth reading is the other one: the JavaScript this stage spends fell from
1024 ms to 298 ms, and what is left is 60% brotli. The stage stopped being
something a rewrite could reach.

## Byte for byte

The layer is an optimization of a function that still exists, and it is only
worth having while the two write the same file.
[`format-layer.test.ts`](../../../packages/sense/src/test-selection/format-layer.test.ts)
runs sixteen cases — every case `mergeCoverage` distinguishes, including
re-recorded and carried modules, retired and demoted tests, modules re-cut from
disk, mislaid text, and a snapshot with nothing underneath it — through both
paths and compares the buffers. A rule added to the merge and not to the layer
fails there rather than in an index somebody has already written.

The one place the two could have disagreed silently is sorting. The dictionary
is ordered by `codeUnitOrder`, which is UTF-16, and the layer wants to order it
by comparing UTF-8. Those agree for every code point below U+E000 and part
company above it, because a surrogate pair sorts under U+E000 by code unit and
over it by code point. Nothing a snapshot holds reaches that far, but "nothing
does" is not a proof: the bytes are checked for it, the comparison falls back to
the strings when the check fails, and a module named `src/😀.ts` is in the test.

## What is left

`sections()` is now 55% of the layer, and it is honest work: run-coding the
columns costs 219 ms and saves 49.3 MB of 52.7, and `packBlob` costs 157 ms and
saves 64%. About a second is the floor for this design at this scale, and it is
mostly a compressor.

The merge's other half is untouched. `mergeCoverage` still exists, still has its
own tests, and is still what a caller with two models in hand should use — the
fold across shards is one, and it is a union rather than a layer.

## The same question, asked once more

`va since` reads the index to find out where it stands, and it was reading it
with `readTestCoverage` — six hundred thousand regions built to reach the forty
hex characters at the head of the file, twice, on a command an operator is
waiting at a prompt for. `recordedCommit` opens the snapshot and reads the one
string. The lesson is the format's, not the layer's: a file whose sections are
addressed by an index at its head can answer a small question small, and the
only thing stopping it was a reader that asked for the model out of habit.
