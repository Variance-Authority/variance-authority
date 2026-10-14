# Sixteen shards fit once freed pages go back

**Date:** 2026-10-15

`variance journeys combine` folds shard records into one record in the native
addon, and `variance journeys <shards…> --into <record>` lands that record.
This entry is the benchmark [ADR-0004](../adr/0004-defer-native-acceleration.md)
asks of native code, and the measurement behind spec 0044's acceptance: sixteen
shards of the 200,000-module fixture, combined and landed, over no record and
over the record a previous run left, each in about 5 s and under a 600 MiB
ceiling.

All three fit: the combine at about 525 MiB and 4 s, the landing over no record
at about 505 MiB and 4 s, and the landing over a record at about 505 MiB and
4.7 s. They fit only because the addon returns large freed blocks to the
kernel, on macOS and on Linux. Without that, the combine on macOS peaks at
about 1.6 GiB, and the landing over a record on Linux at about 640 MiB.

## Method

The machine is an M4 Max with 64 GB and Node 24. Every figure was taken with
the load average under the core count, three runs each. The output of every
combine was compared byte for byte against a reference combined record. The
Linux figures come from the same machine, in a Linux arm64 container (16 CPUs,
8 GiB, Node 22), with the addon cross-built against glibc 2.17.

```bash
cd packages/sense
node scripts/snapshot-scale.mjs shards <dir>    # 16 shard records of the fixture
node scripts/snapshot-scale.mjs combine <dir>   # combineRecords; exits 1 above 600 MiB
cd ../cli
node scripts/land-scale.mjs land <dir>          # journeys <shards…> --into, over no record, then over that record; exits 1 above 600 MiB
```

`main` has no `combine` mode. Its combine is `variance journeys merge
<dir>/*.bin --into <out>` from `main`'s build, and its landing over a record is
`main`'s `landJourneys` over the same shards into a copy of the combined
record, each under `/usr/bin/time -l`.

The fixture has 200,000 modules, 1,600,000 regions, 2,000 test files and about
460 million crossings, cut into 16 shards by test.

## Results

| Path | Build | Wall | Peak |
| --- | --- | --- | --- |
| Combine | `main` (JS fold) | dies at 22 s | about 4.5 GiB, heap exhausted |
| Combine | native, system allocator | 3.9–4.2 s | 1.53–1.57 GiB |
| Combine | native, large blocks unmapped | 3.9–4.5 s | 524–530 MiB |
| Land over no record | native, large blocks unmapped | 4.0–4.1 s | 501–505 MiB |
| Land over a record | `main` (JS fold) | dies at 22 s | about 4.7 GiB, heap exhausted |
| Land over a record | native, large blocks unmapped | 4.7 s | 503–504 MiB |
| Land over no record, Linux | native, system allocator | 3.8 s | about 520 MiB |
| Land over a record, Linux | native, system allocator | 4.4–4.5 s | 624–653 MiB |
| Land over no record, Linux | native, large blocks unmapped | 3.7–3.8 s | 492–496 MiB |
| Land over a record, Linux | native, large blocks unmapped | 4.5 s | 502–504 MiB |

Every combine row wrote the reference bytes. `main` lands through the same
JavaScript fold, so its landing dies where its merge does, whether a record is
there or not.

A landing over a record lays the combined record over the one there in the
addon. It reads both records' columns and writes the landed record in one
pass, through the column writer the combine uses, and neither record is
decoded into the runner's model. Alone, the lay of the fixture peaks at about
340 MiB and takes about 620 ms.

## What the memory was

The combine reads one shard at a time and keeps only what it has accumulated.
The live state at the end is under 600 MiB. The peak was three times that
because macOS's allocator keeps large freed regions in a cache for reuse. Each
shard's decode buffers stayed resident after the shard was done, and the next
shard asked for slightly different sizes. Resident size climbed by part of a
shard's worth per shard.

Pre-sizing the buffers made it worse, about 2 GiB, because every shard then asked
for its largest size up front. Keeping each column's buffer and reusing it for
the next shard, grown to the largest shard, was not enough alone: 1.55 GiB. A
decode frees more than its columns, and those blocks go to the same cache. With the cache turned off
(`MallocLargeCache=0`), the same code peaks at 478 MiB, which says the cache is
the whole difference.

The addon's global allocator maps any block of 4 MiB or more with `mmap` and
unmaps it on free. Smaller blocks go to the system allocator as before. A large
block costs one system call each way and arrives as fresh zeroed pages. With
it, the buffer reuse buys nothing and is gone: interleaved, four runs each, the
combine and both landings take the same CPU time with and without it on macOS
and on Linux, and peak within 30 MiB of each other, every one under 600 MiB. Every
native path gets this, so the scan was measured too, cold `scanRelations` over
a 28,000-file repository:

| System | Path | Allocator | Wall | Peak |
| --- | --- | --- | --- | --- |
| macOS | scan | system | 438–478 ms | 305–322 MiB |
| macOS | scan | large blocks unmapped | 408–445 ms | 295–301 MiB |
| Linux | combine | system | 3.5 s | about 524 MiB |
| Linux | combine | large blocks unmapped, copied to grow | 4.55–4.60 s | 562–568 MiB |
| Linux | combine | large blocks unmapped, remapped to grow | 3.4–3.5 s | 492–498 MiB |
| Linux | scan | system | 378–410 ms | 303–312 MiB |
| Linux | scan | large blocks unmapped, remapped to grow | 383–422 ms | 285–289 MiB |

The Linux scan rows are ten cold runs of each allocator, interleaved, over a
copy of the repository inside the container. Their medians are within 5 ms of
each other.

glibc maps a block above its threshold and unmaps it on free, as the addon
does, but each such free raises the threshold to that block's size, up to
32 MiB. A landing over a record frees the first record's columns, and the
next record's columns then come from the heap, which keeps them resident:
130 MiB more than the same landing on macOS. With the threshold held at 4 MiB
(`MALLOC_MMAP_THRESHOLD_=4194304`), the same build peaks at 493 MiB. Capping
the arenas instead (`MALLOC_ARENA_MAX=2`) reaches 511 MiB and costs time.

Mapping every large block first cost the Linux combine a sixth of its time.
That cost was the copy a growing block paid: a mapping that grows is a new
mapping plus a copy of the old one. On Linux the allocator grows a mapped
block with `mremap`, which moves its pages instead of copying them. The
combine is then as fast as with the system allocator and holds less.

## What it leaves

The landing over a record takes 4.7 s on macOS, close to its 5 s ceiling. The
lay is about 620 ms of it.

On macOS the combine leaves about 140 MiB resident in the system allocator's
small-block zones. Blocks under 4 MiB are not mapped, and macOS keeps the pages
of the ones freed; the landing over a record carries them into its peak.

On a larger corpus, with a wider combined record, the combine peaks at about
1.5 GiB. That is the size of the record it writes, not a held buffer, and the
ceiling is stated for the fixture alone.
