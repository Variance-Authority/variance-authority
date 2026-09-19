# Help stopped parsing what Sense already knew

**Date:** 2026-09-19

Help used the source index for usage and then independently opened, resolved and
parsed the published surface through JavaScript OXC. On the frontend checkout's
Jira workspace that second reading parsed 56,363 files, expanded 37,907
entrypoints, spent 18.30 seconds in its surface walk and reached about 2.99 GiB
RSS. The source index had already paid for the same syntax.

The native read now reduces declaration facts while OXC's arena is resident:
top-level names, declaration kind and line, plus source spans for signatures and
documentation. The compact index carries those facts beside export spans and
the resolved target corresponding to each request. Help follows that indexed
export graph and reads source text only to materialize the spans in the
published closure. The synchronous package reader remains the fallback and the
oracle.

The small fixture compares the complete old and indexed Help values. Separate
cases hold the forms the large checkout exposed: a default export of an imported
binding through a second barrel, a named default declaration exported again
under its local name, namespace bindings and anonymous default values. The
native and JavaScript harvesters agree over every module in this repository.

## The acquisition experiment failed usefully

The first native graph read clean files through persistent `git cat-file
--batch` streams. At scale it could remain alive for minutes with little CPU.
The parser was not the wall. Six bounded worktree readers completed the same
cold acquisition in 9.29 seconds; resolution took 4.36 seconds, compact-index
encoding 1.75 seconds and column construction 0.52 seconds over 300,427 files.
The persistent blob-reader implementation was removed rather than kept as an
unmeasured alternative.

This also corrected two scope assumptions. A tracked directory named `build`
can be source and therefore stays in Git-seeded discovery, while generated
`build` directories remain excluded from filesystem discovery. A scan rooted
inside a larger checkout now asks Git only about that subtree and strips Git's
repository prefix before opening paths.

The Jira workspace crosses its directory through the `platform` symlink. Help
therefore discovers offerings from the requested workspace but scans the real
repository roots those offerings occupy. Manifest discovery accepts JSONC
tsconfig files, expands source wildcards and reports stale entrypoints as
unreadable instead of aborting the other 23,000 openings.

## End-to-end result and remaining wall

A fresh end-to-end Help read over the Jira, platform and post-office roots
completed in 47.87 seconds and returned 1,632 packages, 23,503 openings, 80,994
published entries and 660,576 repository exports. Repeated unchanged runs
completed in 30.91–33.43 seconds. They did no second OXC parse.

One instrumented unchanged run split as follows:

```text
manifest discovery                         0.56 s
compact index load                         3.20 s
Git snapshot + replay of 300,427 records  19.82 s
usage join                                 0.46 s
published-name closure                     2.45 s
Help assembly                              2.28 s
unchanged save                             0.00008 s
```

Measured separately over the same roots, `git ls-tree` took 0.65 seconds and
`git status` 8.93 seconds. Git is about 29% of the warm total, not most of it;
the rest is loading and replaying a repository-wide answer for a consumer that
also asks for every export.

The next reductions have different contracts. A caller that already knows the
changed paths can bypass status discovery, and a query-shaped Help consumer can
avoid materializing every repository export. Neither is required to remove the
duplicate parse, and folding either into this change would conceal which saving
was earned.

## The consumer stopped copying the repository

The first large-workspace measurement after adding scoped frequency looked like
a regression: 53.70 seconds for one Help read. It was a cold reading against a
default index path that did not exist, with saving disabled. A deliberately
saved generation established the warm comparison instead.

The warm path then exposed a consumer-side copy. `scanRelations` handed every
cached parse to Help, Help expanded it into a `Recorded` object graph, and
`usageFrom` immediately traversed that graph into the actual usage index. The
temporary graph retained 300,682 file records and every request and binding long
enough to make the join, even though the final answer already had its own compact
shape.

Help now joins the cached `Parsed` facts directly into usage while the scan
replays them. The fixture oracle remains byte-for-byte equivalent. On the same
saved Jira-scale generation, two unchanged readings moved from 40.5 seconds to
26.5 and 26.4 seconds. The scan-and-consumer phase moved from 31.1 seconds to
17.9 and 17.8 seconds; manifest discovery, published-name closure and final Help
assembly did not move materially.

This is still a repository-wide refresh, not an instant query. About sixteen
seconds remains in the unchanged graph scan itself, including Git discovery.
The next meaningful boundary is therefore incremental input: a caller that
already knows the changed paths should hand them to Sense rather than asking Git
to rediscover them. Rewriting the direct usage join in Rust would attack the
smaller part that remains.

The incremental entrance is explicit rather than heuristic. `scanRelations`
and `readWorkspace` accept an authoritative scan-root-relative `changed` list.
Git still supplies the committed path set and hashes those files from disk, but
does not run status. Additions and deletions are represented by presence on disk;
a rename names both paths. Omitting the option retains discovery, while an empty
list asserts that the caller knows nothing moved.

On the clean Jira-scale checkout, two runs through that entrance completed the
same Help reading in 15.56 and 14.16 seconds: 300,682 graph records, 80,994
published entries and 660,576 repository exports. The ordinary discovery path took 26.4 seconds on the same
saved generation. The first comparison exposed one stale JavaScript oracle rule:
it excluded tracked files below a directory named `build`, while the native Git
seed correctly treated tracking as evidence that the directory held source. The
oracle now keeps tracked `build` source and continues to exclude generated build
directories during filesystem discovery.

The library entrance was not enough for the shell consumer. `variance ask` now
accepts `--changed-file`, a newline-delimited authoritative list supplied by an
editor, watcher or orchestrator. The warmed Jira-scale command, including graph
folding and the scoped query, completed in 17.60 seconds and returned the same
44,426-file issue-view closure as discovery. The preceding discovery-backed CLI
run took 33.13 seconds after its index had stabilized.

The shell entrance also accepts an addition-only Sense table through
`--taint-file`. A temporary Jira table generated from 2,190 text-search
candidates held 2,024 callers and occupied 322,997 bytes. With that table and
the authoritative clean change file, the real scoped CLI query completed in
20.32 seconds and expanded issue-view from 44,426 to 60,360 reachable files.
Candidate discovery and table generation remain bootstrap/user-space work; a
question reads the bounded table rather than searching the repository again.
