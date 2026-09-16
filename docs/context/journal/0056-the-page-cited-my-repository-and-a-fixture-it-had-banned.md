# 0056 — the page cited my repository, and a fixture it had banned

**Date:** 2026-09-16

Two clean-room sweeps over `docs/scale.md` reported together, and then the human
read the first paragraph and found the defect neither sweep was looking for.

## The one that mattered most, and no agent could have found it

The page opened:

> A record of which test entered which line, in a repository of two hundred
> thousand files where one test file imports forty thousand of them

That is not a fixture description. It is a description of **her repository**,
told to me in conversation, published on a page anyone can read. Flagged as
"leaking session information", which is exactly what it is.

The lesson is not about this sentence. It is that a measurement's *motivating
case* travels into the copy without ever passing the check the measurement
itself passes. Nobody reviews a lead paragraph for provenance; every reviewer
reviews the table. Both sweeps read that sentence — thirty-five agents on one,
fifty on the other — and neither had a reason to ask where 40,000 came from,
because in context it reads as the fixture's parameter. It is in
`snapshot-scale.mjs`'s docblock as a fixture parameter, which is what made it
invisible.

Grepped afterwards: `200,000` is genuine pre-existing benchmark vocabulary
(`docs/execution-record.md`, `docs/source-index.md`, `packages/sense/README.md`),
so it stays. `forty thousand` appeared only on this page, only in the sentence
that described a real repository. Now "tens of thousands of modules".

No session path leaked into the tree — checked for the scratchpad root, the
session id and `/private/tmp/claude` across everything but `node_modules`,
`.git` and `dist`. The only absolute home path in the repo is a pre-existing
`backlog/tasks/task-2` asset reference.

## The lead was rewritten to her framing

The instruction was "no numbers, no details, but user 'feels' welcomed", with
the shape to hit: *not everything is designed for scale, and so it dies; a very
large enterprise tree may be a rock; this is built for hundreds of thousands of
files of quickly-grown code where some tests touch half the codebase; if it
works there it is fast for you.*

So the page no longer opens on the two fears and their two refutations. It opens
on who it is for and who it is not for, and the arithmetic starts at the first
heading. The two claims that had been the lead — we do not produce thirty
gigabytes of coverage data, and reading it does not need two gigabytes — are
still the page's argument; they are just the sections now, not the pitch.

## The fatal finding: the page banned a fixture and then quoted it

`## What these numbers are, and are not` says the large fixture may answer how
long, how many bytes and how much memory, and may **not** answer how many tests
you skip, because the test-to-module axis is synthesized. Thirty lines earlier
the page printed:

| a diff of 100 files | tests run |
|---|---|
| adjacent — one feature, one subtree | 499 of 2,000 |
| scattered across the repository | 1,999 of 2,000 |

`of 2,000` is the large fixture. Every cell is a share-of-the-suite figure from
the fixture the page had just forbidden to produce one. A reader who catches
that has no reason to believe any other boundary the page draws.

The reviewer's first proposed fix — re-run it on Material UI — is wrong, and the
verify pass caught that too:

```bash
node packages/sense/scripts/selection-scale.mjs band {MATERIAL-UI} 200
```

```
shape      files      ms   rss      run    skip
clustered     1     2.9     8M       8     176
clustered     2     0.3     0M       9     175
clustered     5     0.3     0M      31     153
clustered    10     0.4     0M     150      34
clustered   100     1.5     2M     158      26
spread        1     0.1     0M       4     180
spread        5     0.2     1M     155      29
spread       10     0.2     1M     157      27
spread      100     1.6     1M     164      20
```

At 100 files the contrast is 158 against 164 of 184 — there is none, because a
100-file diff is an eighth of MUI and a third of its files are hubs. The real
contrast lives at five files: **31 against 155 of 184**, five times the suite
for the same file count in a different place. That is a better claim than the
synthetic one, because it is the same claim measured on a repository nobody
here wrote.

And the row *below* it is the honest one the synthetic table never had: widen
the clustered diff from five files to ten and the run goes 31 → 150, because the
subtree grew to contain a hub. Adjacency is worth five times the suite right up
until the cluster swallows a hub, which is the same finding as `## What decides
the value` and now agrees with it out loud.

## The read count had been counting the reads that opened the file

`selection-scale.mjs`'s `reads` arm captured `const opening = bytes` and then
printed `bytes - opening` against a bare `reads`. Bytes were subtracted, the
read counter was not, so the table paired an answering-only byte figure with a
whole-process read count — while the row directly above it already charged the
opening reads separately.

Fixed at the source (`const openingReads = reads`, and both lines print their
own count), so the script can no longer contradict its own subtracted figure:

```
LARGE       opening 43.2 KB in  40 reads   answering 100 files 3.69 MB in 498 reads   4.8%
MATERIAL-UI opening  1.8 KB in   4 reads   answering 100 files 0.26 MB in  23 reads  52.8%
```

The page's cells were 538 and 27; they are 498 and 23. Small, and the kind of
error that costs the most when someone reproduces it.

## Three of ten findings were already dead

The style lens filed nine, four of which quoted sentences that a rewrite had
already removed ("The whole scan allocates one array of two thousand integers
and nothing else", "One structure carries the weight…", and a duplicate link to
`selecting.md#where-selection-widens` that no longer appears twice). Reviews of
a document under active edit report against the version they read, so the verify
pass has to re-quote every finding against the file on disk — which this one
did, with line numbers, and that is the only reason the triage was cheap.

The six that survived and landed are all deletions or number corrections. Five
were sentences telling the reader how to read the page ("This page is the
arithmetic…", "Two more things, stated because…", "And then there is the
finding that should actually decide whether you install this"). A page that
narrates itself is a page that does not trust its own headings.

## The disbelief sweep's best objection is about the half this page does not cover

Thirty-five agents, and the strongest surviving objection is not about reading
at all:

> The reporter that actually ships is the one this repository already documented
> as dying at a quarter of the target scale — the streaming replacement exists
> and is wired to nothing.

Measured by that agent on the shipped producer path
(`snapshot-scale.mjs record`, which imports `dist`'s `crossingsOf`,
`coverageModule` and `encodeTestCoverage`): at 32 of 2,000 test files, 1,365 MB
after `crossingsOf` and 2,497 MB after the encoder; at 128 test files, 4,108 MB.
Against a 600 MB ceiling. The same fixture through `foldCrossings` is 128 MB and
243 MB. That is journal 0051's defect restated with a sharper number:
the ceiling does not break at 500 test files, it breaks at about 32.

None of that is new — it is journal 0051's defect and the combiner task — but it
decides one sentence of public copy. The page reports `crossings.mjs`'s **132 MB
built, stored and queried**, which is the pool primitive's own build cost, and a
reader who has just been shown a build figure will carry it to "so recording my
repository costs that". It does not. So the page now says, once, in the section
that already scopes its own evidence:

> **These are the cost of holding the relation and reading it.** The figures for
> building it are the structure's own, measured by the benchmark that builds it.
> What a full suite costs to record is a separate measurement on a separate
> path, and this page does not report it.

A position, not an apology, and not an advertisement of a defect that is
tracked. The write path is a bug with an owner, and the rule is that the public
page must not imply the bug is absent — not that it must confess it.

## The safety check could not be run on a large repository

`select-check.mjs` is the instrument for the one figure the public page says is
missing — whether a skip list is *right*. It opened with
`await readTestCoverage(SNAPSHOT)`, the full decode, and then used exactly two
things out of it: every test file's path, and the module count for a log line.
Nothing else in the script touched `coverage` at all.

Measured on the 77.2 MB 200k fixture, FORMAT 8, built `dist`:

```
readTestCoverage                                273.6 s, 5,303 MB peak
openCoverageFile + view.string(view.testPath.at(i)) per row
                                                  0.018 s,  113 MB peak
```

Four and a half minutes and nine times the ceiling, to obtain a list of strings
that is sitting in a column. The substitution is exactly equivalent, checked
rather than argued: on `mui-full.v8.bin` the view-derived list is identical to
`coverage.tests.map((t) => t.file)` — 184 entries, same order — and
`view.modulePath.length` equals `coverage.modules.length` at 791.

Replaced, with the descriptor released before the mutation loop begins, because
the loop's own queries reopen the file through `askCoverageFile`. Running the
whole script against the large fixture with an empty plan now reaches its first
line in **0.06 s at 112 MB**.

**What this does not buy.** It does not make the check runnable at the 200k
target shape, and no commit message or doc may say so. Steps 1 and 3 mutate a
real source file and spawn `vitest run` over a real suite; the 200k fixture is a
synthesized snapshot with no source tree behind it. What the change buys is the
check on a large *real* repository, where the decode — not the suite run — was
the thing that made it impossible. That is the honest claim and it is the only
one to make.

The general shape is worth keeping: **a script that reads a snapshot for two
scalars should never decode it.** The view exists; the full decode is for callers
who need the object model, and a benchmark harness almost never does.

## Gates

`yarn lint` 11 errors, `yarn check` 4 failures (`engineStatus`, two `shape.check`
line counts, the `surface.check` baseline), 11,967 passing. All four pre-existing
and unrelated; the docs gates pass over the rewritten page.
