# Bulk attributes and thread priority buy the scan nothing

**Date:** 2026-09-27

[BlitzTree](https://github.com/ahmedkhaleel2004/blitztree) is a macOS disk-usage
treemap that scans 3.1M entries in 10.2 s. It gets there by three moves:

- `getattrlistbulk(2)`, which reads a whole directory's metadata in one syscall;
- rayon workers raised to `QOS_CLASS_USER_INITIATED`, because at a GUI app's
  default QoS they ran on the efficiency cores and scanned twice as slowly;
- a flat CSR tree handed to Swift as raw pointers.

This entry measured each one against the sense addon. None of them transfers.
The one number worth keeping is ours: a process clamped to background QoS reads
10–30× slower, and nothing inside the process can undo that.

Corpus: one clone of Material UI `8f19b1009b`, 41,171 tracked paths, 27,792
readable seeds under `.`. Machine: M4 Max (12 performance and 4 efficiency
cores), 64 GB, Node v26.7.0, the addon prebuilt for `darwin-arm64`. The load
average was about 7 from other sessions. Every cell is the median of
five calls, and the ranges are over three processes.

## Bulk attributes are slower than the walk we already have

`getattrlistbulk` wins against `readdir` plus one `lstat` per entry. That is
BlitzTree's baseline, because it needs sizes. `seed_files` in
`packages/sense/native/src/seed.rs` needs only names and types, and `readdir`
gives the type in `d_type` without a stat. A single-threaded C walk of the clone,
skipping `.git` and `node_modules` (72,460 files, 1,656 directories), warm:

| walk | ms |
|---|---|
| `readdir`, `d_type` | 48–67 |
| `getattrlistbulk(ATTR_CMN_NAME \| ATTR_CMN_OBJTYPE)`, 256 KB buffer | 113–120 |

Bulk attributes cost 2.3× more. `seedFiles(root, ['.'])` through the addon cost
50–64 ms, and it runs only for a scan that git does not describe. There is
nothing here to borrow.

The per-file cost that remains is opening files for their contents. That is the
53 µs descriptor `FILES_PER_PROCESS` in `acquire.rs` already avoids by reading
blobs through `cat-file --batch`. `getattrlistbulk` does not read contents.

## Thread QoS changes nothing unclamped, and cannot undo a clamp

The sense rayon pools set no `start_handler`, so their threads take the
process's QoS. The addon's own paths, run under three task clamps:

```bash
ADDON=packages/sense/npm/darwin-arm64/scan.node ROOT=~/dev/material-ui REPS=5 node bench.mjs
taskpolicy -c utility    node bench.mjs
taskpolicy -c background node bench.mjs
```

`bench.mjs` times `gitTreeFor(root, ['.'])`, `seedFiles(root, ['.'])`,
`readBatch(root, seeds)` (every seed read off disk) and `tree.scanBatch(root,
seeds)` (read through `cat-file`, parsed and resolved):

| clamp | `gitTreeFor` | `seedFiles` | `readBatch` | `scanBatch` |
|---|---|---|---|---|
| none (a shell under the Claude desktop app) | 75–77 | 50–64 | 276–470 | 291–316 |
| utility | 75–76 | 51–62 | 264–320 | 287–304 |
| background | 394–551 | 346–556 | 2,418–9,362 | 3,008–5,770 |

Utility costs nothing. Background costs 5–7× on the git calls and 10–30× on
reads, because it both moves the threads to the efficiency cores and throttles
their I/O.

A C probe with six threads each spinning 4×10⁸ iterations separates the two
questions:

| clamp | threads left at default | threads set to user-initiated |
|---|---|---|
| none | 486 ms | 466 ms |
| background | 7,684 ms | 8,465 ms |

Unclamped, default-QoS threads already run on the performance cores. BlitzTree
lost speed because its threads lived inside a GUI app process, and sense runs
inside Node. Clamped, a thread's QoS request is capped by the task clamp, so
`pthread_set_qos_class_self_np` cannot raise it. A `start_handler` would be
inert in both cases.

A process also cannot reliably tell that it is clamped:
`getpriority(PRIO_DARWIN_PROCESS, 0)` returns 0 under `taskpolicy -c
background` and sets `PRIO_DARWIN_BG` only under `taskpolicy -b`. So the answer
is for the launcher not to clamp. The addon cannot see the clamp or remove it.

Nothing we ship today starts sense detached, through launchd, or below the
caller's priority. This matters to the daemon in
[spec 0056](../../specs/0056-a-session-daemon-keeps-the-index-current.md) and
to the editor extension in
[spec 0063](../../specs/0063-an-editor-asks-about-the-text-it-holds.md). Both
are started by a host whose QoS we do not choose. Spec 0056 now states it.

## The flat handoff is already flat

A `scanBatch` over the 27,792 seeds returns columns: `counts` as a
`Uint32Array` prefix sum, `kinds` and `parsed` as `Buffer`s, and 270,200 JS
strings across `values`, `targets`, `declares`, `digests`, `files` and `parses`.
Rebuilding the 214,616 short strings of the first four from one UTF-8 blob cost
15 ms in JS. That is the upper bound on what a blob-and-offsets layout could
save on a 290 ms batch, and the store keeps them as strings anyway, so it would
only move the cost.

## Reproduction

The probes were throwaway files, and the tables above are their whole output.
`bench.mjs` loads the addon with `createRequire`, calls
`addon.gitTreeFor(ROOT, ['.'])` once for `seeds()`, then times each call above
`REPS` times with `process.hrtime.bigint()` and prints the medians as JSON. The
walk opens each directory with `O_DIRECTORY` and loops `getattrlistbulk` with
`ATTR_CMN_RETURNED_ATTRS | ATTR_CMN_NAME | ATTR_CMN_OBJTYPE`, and it runs the
`readdir` walk first in each round so both read a warm cache.
