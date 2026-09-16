# The snapshot fits and the publish does not

[Journal 0050](./0050-six-hundred-million-crossings-were-three-thousand-sets.md)
measured the primitive. This measures the artifact and the two operations
performed on it: answering a diff, and laying a run over it. One of them is
comfortably inside the budget and the other is nearly twice outside it, and the
gap between those two sentences is the current state of this feature.

The fixture is a real FORMAT 8 file, written column to column, and read back
through the shipped reader:

```
node packages/sense/scripts/snapshot-scale.mjs build {SNAPSHOT} 200000 2000 8
```

200,000 modules, 1,600,000 regions, 2,000 test files of a forty-thousand-module
shape. **77.2 MB.**

## Answering does not read the file

```
node packages/sense/scripts/selection-scale.mjs reads {SNAPSHOT} 100
```

```
the file            : 77.2 MB
opening it read     : 43.2 KB
answering 100 files : 3.69 MB in 538 reads
                    : 4.8% of the file
the answer          : run 499, skip 1501
```

A column is a run of bytes at an offset, so opening the snapshot reads the
section table and the manifest and nothing else — **43 KB of 77.2 MB** — and an
answer reads the runs it touches. A hundred changed files cost 538 positional
reads totalling 3.7 MB.

That fraction is a property of the *scale*, and it moves the reassuring way. The
same arm against Material UI's real recorded suite — a 0.5 MB file — reads
**52.2%** of it to answer for ten files. The larger the repository, the smaller
the share of it any one question touches, because the question is still about one
subtree and the file grew everywhere else.

## What one answer costs end to end

```
/usr/bin/time -l node packages/sense/scripts/selection-scale.mjs band {SNAPSHOT} 100
```

| | ms | peak rss |
|---|---|---|
| the whole command, one answer, cold | 60 ms real | 116 MB |
| the whole command, seven answers | 230 ms real | 163 MB |

Inside the process, the first answer costs **21 ms** and the second costs **2**.
The difference is not caching in any layer this project wrote: it is the column
runs the first question decompressed, which the second question finds already
decompressed. A run that asks once pays 21 ms; a watcher that asks on every save
pays 2.

The band, clustered — the shape a pull request actually has:

| files | ms | run | skip |
|---|---|---|---|
| 1 | 21.9 | 482 | 1,518 |
| 10 | 2.7 | 482 | 1,518 |
| 100 | 8.0 | 499 | 1,501 |

Spread evenly over the repository instead, which is the worst a diff of that size
can be shaped like, 100 files run 1,999 of 2,000 and cost 55 ms. Both rows are
worth keeping. The first is what happens; the second is what a reviewer will
assume happens.

## Publishing is over the ceiling

The other operation is laying a run's re-recorded modules over the snapshot and
writing it back. Ten modules of two hundred thousand, twenty tests of two
thousand — a single test file re-run:

```
/usr/bin/time -l node packages/sense/scripts/snapshot-scale.mjs layer {SNAPSHOT}
```

```
read: 77.2 MB snapshot
layered: 10 of 200,000 modules re-recorded, 20 of 2,000 tests re-run, in 3.1s
  out: 71.6 MB
  reads back: 200,010 modules, 2,047,521 regions, 273,045 distinct sets
peak rss 1111.3 MB against a 600.0 MB ceiling — OVER
```

**Three seconds and 1,111 MB to record that one test file ran.** The work is
proportional to the snapshot and not to the run: the whole file is decoded to a
model, ten modules are replaced in it, and the whole file is encoded again.
Nothing about that is inherent — the ten modules are known, their regions are
known, and the other 199,990 rows are bytes that could be copied — but the
encoder takes the logical model, so today it materializes one.

This is the write-side twin of the object model [journal
0050](./0050-six-hundred-million-crossings-were-three-thousand-sets.md) ends on,
and it is the reason the per-save path cannot be "publish". What it needs is an
append-only overlay in front of the snapshot — a run writes what it saw, reads
answer through the overlay, and the fold into the snapshot happens on a cadence
somebody chooses rather than on every keystroke. That is unbuilt.

**It is a defect, not a limit, and it is not published.** `docs/performance.md`
and the public scale page describe what answering costs, which is measured and
true. Neither claims a publish figure, because the honest one is 1,111 MB.

## One number that reads oddly, and why it is right

The fixture holds **273,045** distinct crossing sets where `crossings.mjs`
reports 3,408 for a repository of the same size. The two generators divide their
cohorts differently, and this one divides them harder. The 77.2 MB file is
therefore the *pessimistic* of the two — the pool sharing less, the relation
columns larger — and every figure on this page is measured against it. A
repository whose barrels behave more like the first fixture gets a smaller file
and the same answers.
