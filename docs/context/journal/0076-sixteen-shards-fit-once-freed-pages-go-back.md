# Sixteen shards fit once freed pages go back

**Date:** 2026-10-15

`variance journeys combine` folds shard records into one record in the native
addon. This entry is the benchmark [ADR-0004](../adr/0004-defer-native-acceleration.md)
asks of native code, and the measurement behind spec 0044's acceptance: sixteen
shards of the 200,000-module fixture combined under the 600 MB ceiling.

The fold fits: about 590 MB peak and about 4 s. It fits only because the addon
returns large freed blocks to the kernel. Without that, the same fold peaks at
about 3.3 GB.

## Method

The machine is an M4 Max with 64 GB and Node 26. Every figure was taken with
the load average under the core count, three runs each. The output of every run
was compared byte for byte against a reference combined record.

```bash
cd packages/sense
node scripts/snapshot-scale.mjs shards <dir>                  # 16 shard records of the fixture
/usr/bin/time -l node scripts/snapshot-scale.mjs combine <dir>  # combineRecords; exits 1 above 600 MiB
```

There are two inputs:

- **The fixture.** It has 200,000 modules, 1,600,000 regions, 2,000 test files
  and about 460 million crossings, cut into 16 shards by test.
- **A synthetic corpus.** It has 18 shards and about 220 MB in all: about
  30,000 test files, 90,000 modules, 500,000 regions and 370,000 cases, with
  durations and case indexes.

## Results

| Input | Build | Wall | Peak RSS |
| --- | --- | --- | --- |
| Fixture | `main` (JS fold) | dies at 22 s | about 5 GB, heap exhausted |
| Fixture | native fold, system allocator | 8.3 s | 3.3 GB |
| Fixture | native fold, large blocks unmapped | 3.9–5.7 s | 570–610 MB |
| Corpus | `main` (JS fold) | about 22 s | — |
| Corpus | native fold, large blocks unmapped | 3.8–4.1 s | 1.6 GB |

The ceiling is 600 MiB, which is 629 MB. The gate reads the process's own
peak, and across three runs it reported 540–560 MiB and exited 0.

## What the memory was

The fold reads one shard at a time and keeps only what it has accumulated. The
live state at the end is under 600 MB. The peak was five times that because
macOS's allocator keeps large freed regions in a cache for reuse. Each shard's
decode buffers, about 160 MB, stayed resident after the shard was done, and the
next shard's buffers were sized differently and did not reuse them. Resident
size climbed by a shard's worth per shard.

Pre-sizing the buffers made it worse, 2.1 GB, because every shard then asked
for its largest size up front.

The addon's global allocator now maps any block of 4 MB or more with `mmap`
and unmaps it on free. Smaller blocks go to the system allocator as before. A
large block costs one system call each way, and it arrives as fresh zeroed
pages. At the fold's sizes, that call is noise against decompressing the block.
Every native path gets this: none of them keeps large buffers alive across
calls.

## What it leaves

The corpus peak, 1.6 GB, is live state: the corpus's combined record is wider
than the fixture's. The ceiling is stated for the fixture, and the corpus is not
gated.

Two builds of one module in one fold are still refused, as spec 0044 item 8
records.
