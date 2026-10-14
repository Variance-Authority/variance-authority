# Sixteen shards fit once freed pages go back

**Date:** 2026-10-15

`variance journeys combine` folds shard records into one record in the native
addon, and `variance journeys <shards…> --into <record>` lands that record.
This entry is the benchmark [ADR-0004](../adr/0004-defer-native-acceleration.md)
asks of native code, and the measurement behind spec 0044's acceptance: sixteen
shards of the 200,000-module fixture, combined and landed, each in about 5 s
and under a 600 MiB ceiling.

Both fit: the combine at about 525 MiB and 4 s, the landing at about 530 MiB
and 4.5 s. On macOS they fit only because the addon returns large freed blocks
to the kernel. Without that, the same combine peaks at about 1.6 GiB. Linux
needs nothing: glibc already returns them.

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
node scripts/land-scale.mjs land <dir>          # journeys <shards…> --into, over no record; exits 1 above 600 MiB
```

`main` has no `combine` mode. Its column is `variance journeys merge
<dir>/*.bin --into <out>` from `main`'s build, over the same shards, under
`/usr/bin/time -l`.

The fixture has 200,000 modules, 1,600,000 regions, 2,000 test files and about
460 million crossings, cut into 16 shards by test.

## Results

| Path | Build | Wall | Peak |
| --- | --- | --- | --- |
| Combine | `main` (JS fold) | dies at 22 s | about 4.5 GiB, heap exhausted |
| Combine | native, system allocator | 3.9–4.2 s | 1.53–1.57 GiB |
| Combine | native, large blocks unmapped | 3.9–4.5 s | 524–530 MiB |
| Land over no record | native, large blocks unmapped | 4.2–4.6 s | 527–530 MiB |

Every combine row wrote the reference bytes. `main` lands through the same
JavaScript fold, so its landing dies where its merge does.

## What the memory was

The combine reads one shard at a time and keeps only what it has accumulated.
The live state at the end is under 600 MiB. The peak was three times that
because macOS's allocator keeps large freed regions in a cache for reuse. Each
shard's decode buffers stayed resident after the shard was done, and the next
shard asked for slightly different sizes. Resident size climbed by part of a
shard's worth per shard.

Pre-sizing the buffers made it worse, about 2 GiB, because every shard then asked
for its largest size up front. Keeping each column's buffer and reusing it for
the next shard, grown to the largest shard, is what the combine does now, and
it is not enough alone: 1.55 GiB. A decode frees more than its columns, and
those blocks go to the same cache. With the cache turned off
(`MallocLargeCache=0`), the same code peaks at 478 MiB, which says the cache is
the whole difference.

On macOS the addon's global allocator maps any block of 4 MiB or more with
`mmap` and unmaps it on free. Smaller blocks go to the system allocator as
before. A large block costs one system call each way and arrives as fresh
zeroed pages. Every native path on macOS gets this, so the scan was measured
too, cold `scanRelations` over a 28,000-file repository:

| System | Path | Allocator | Wall | Peak |
| --- | --- | --- | --- | --- |
| macOS | scan | system | 438–478 ms | 305–322 MiB |
| macOS | scan | large blocks unmapped | 408–445 ms | 295–301 MiB |
| Linux | combine | system | 3.85–3.87 s | 543–552 MiB |
| Linux | combine | large blocks unmapped | 4.55–4.60 s | 562–568 MiB |
| Linux | scan | system | about 4.65 s | 308–314 MiB |
| Linux | scan | large blocks unmapped | about 4.67 s | 283–286 MiB |

The Linux scan reads through a bind mount and is bound by it. On Linux the
mapping costs the combine a sixth of its time and saves no peak, so the
allocator is compiled for macOS alone.

## What it leaves

Landing over a record that is already there decodes the combined record into
the runner's model before laying it, and at this scale that model does not fit:
it runs out of heap, as it does on `main`. A landing over nothing reads the
record's columns instead. Laying a record over a record without the model moves
the layering rule into the addon, and is marked where the landing decodes.

On a larger corpus, with a wider combined record, the combine peaks at about
1.5 GiB. That is the size of the record it writes, not a held buffer, and the
ceiling is stated for the fixture alone.
