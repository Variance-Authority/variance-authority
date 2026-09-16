# 0055 — the public page had to say what it could not answer

**Date:** 2026-09-16

`docs/scale.md` exists now, and it is the answer to one sentence of feedback: a
lot of people will not believe journeys are physically possible at two hundred
thousand files.

The first draft was a table of milliseconds, and the correction to it was worth
more than the draft: **do not micromanage numbers — the two things to prove are
that we do not produce thirty gigabytes of coverage data, and that reading it
does not require two gigabytes of memory.** Everything else on the page is
supporting arithmetic for those two sentences, and the draft had buried both
under precision nobody asked for. The page now opens on the two fears in the
reader's own words, spends its figures in orders of magnitude, and keeps the
per-arm detail here instead.

## Every figure re-run before it was written down

Nothing was copied out of an earlier entry. Each arm was re-run against today's
tree and today's fixtures, and the page carries this run's numbers, not the ones
from the day the arm was written.

```
node packages/sense/scripts/selection-scale.mjs reads  {200K} 100
node packages/sense/scripts/selection-scale.mjs band   {200K} 100
node packages/sense/scripts/selection-scale.mjs hubs   {MUI}
node packages/sense/scripts/selection-scale.mjs hubs   {200K}
node packages/sense/scripts/selection-scale.mjs neighbours {MUI} 12
node packages/sense/scripts/selection-scale.mjs decode {200K}
node packages/sense/scripts/crossings.mjs 200000 2000 8
node packages/sense/scripts/crossings.mjs 200000 2000 8 worst
```

| question | this run |
|---|---|
| the file | 77.2 MB, 2,047,441 regions |
| opening it | 43.2 KB read |
| answering 100 changed files | 3.69 MB in 538 reads, **4.8%** of the file |
| the same arm on the MUI recording | 1.8 KB open, 0.26 MB in 27 reads, **52.8%** |
| whole command, cold | **0.07 s real, 119.6 MB peak** |
| clustered 1 / 10 / 100 files | 27.6 / 3.1 / 10.4 ms — run 482 / 482 / 499 of 2,000 |
| spread 1 / 10 / 100 files | 4.1 / 12.9 / 85.4 ms — run 542 / 1,818 / 1,999 |
| hub scan, MUI | 5 ms, 5.8 µs/file, 70 MB; p50 7.1%, p90 84.2%, worst 89.7%, 250 files (31.6%) at ≥50% |
| hub scan, 200k | 4,009 ms, 20.0 µs/file, 322 MB (4.06 s real, 337 MB peak) |
| naming the suite vs counting it | 16.5 ms vs 0.03 ms, **659x** |
| crossing pool | 671,435,488 crossings → 3,408 sets, 132 MB peak, 5,123 MB as pointers |
| the same pool with no sharing at all | 1,600,000 sets, 386 MB of containers, 510 MB peak |

The second question inside one process costs 2.4 ms against the first question's
27.6 ms, which is the decompressed column run being reused. That ratio is the
whole case for a watch loop, and it is on the page as a ratio rather than as a
promise.

## The two sections that cost the most to write

A page of favourable numbers is a brochure. Two sections stop it being one, and
both of them are there because a review pass found them, not because the numbers
invited them.

**The diffs in the benchmark are all modules the record has seen.** They are
drawn from the snapshot's own module list, so `unread` is **0 in every row of
the band table** — by construction, not by luck. A real pull request has a
config file, a generated file, a module added since the recording, and any one of
those retires the skip list for the whole run. That is the safe behaviour and the
reader is entitled to know the benchmark never exercises it. The page says so,
and points at `docs/selecting.md`'s widening section for which changes do it.

**Cost is not safety.** Every figure above is bytes, milliseconds and resident
memory. None of them says the skip list was right. The honest sentence is that
the only figure which settles it is how often a skipped test would have failed,
and the project does not publish one. That is a gap with a name now, and it is
the next measurement worth building rather than a caveat to write around.

## The half that was nearly left out

The page also has to say where an observation comes from, because the answer is
different in the two places a reader will use it and the difference is the whole
operational story:

- **Locally there are workers and no shards.** One runner process, however many
  workers it spawns, one snapshot: each test file writes its own journal into
  the run directory as it finishes, and the reporter reads them and writes the
  file (`vitest.ts:313` over `readJournals`). There is no fan-in to operate and
  no server in the path — `SelectionRun` is keyed by the snapshot being written,
  which is exactly the scope of one run.
- **In CI there are shards, and they are stitched afterwards.** One snapshot per
  shard, and `foldTestCoverage` is the union the unsharded run would have
  written — refusing rather than guessing where the shards were not one run, and
  letting *unknown* win wherever they disagree about readability. The stitched
  snapshot is the one that gets shared.
- **A shared snapshot is supported and never depended on.** Record one locally,
  fetch the one CI stitched and layer today's run over it, or work from nothing:
  an absent or stale one costs a slower answer and never a different one. That
  is the same property the scan caches have, and for the same reason.

All three were already true and already built; none of them was on a public page,
and the fold's own guarantees were only reachable through `packages/sense`'s
README. That is the kind of thing that gets called missing by a reader who cannot
find it.

## The rule the page inherits from 0054

Stated in the reader's terms this time: every latency, byte and memory figure
from the large fixture stands, and not one selectivity figure does. So the band
table and the reads table are the large fixture, and every share-of-the-suite
number — the hub distribution, the 78% file, the 17% subtree — is the Material UI
recording. The page names both fixtures in its second section, before it quotes
a single figure from either, and it names which axes were drawn from the
recording and which one was synthesized.

## What the page deliberately does not carry

The publish path measured in [journal 0051](./0051-the-snapshot-fits-and-the-publish-does-not.md)
— 3.17 s and 1,116 MB to write the layer at target shape — is over the 600 MB
operating ceiling and is a defect, not a position. A defect does not go on a
public page to be apologised for; it goes in the journal to be fixed, and the
write-side cadence work is what fixes it.

Relates to [journal 0054](./0054-the-scale-fixture-was-mui-wearing-a-larger-coat.md),
[journal 0053](./0053-one-file-cost-four-fifths-of-the-suite.md),
[ADR-0062](../adr/0062-a-skip-list-is-bounded-by-what-the-record-witnessed.md).
