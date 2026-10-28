# Distill read every crossing to count files

**Date:** 2026-10-15

`variance distill` over a whole recording read each test file's coverage rows
and the record's case index into JavaScript objects, one per crossing, then
walked the import graph from every test file in JavaScript. On a suite of about
30k test files it took most of a minute and several gigabytes; on a larger one
it did not finish. A scope reading needs far less: per test file, the modules it
loaded, and per module, how many cases of that file entered it. That is now read
once, in the sense addon, and the walk runs there too. This entry is the
measurement ADR-0004 asks for before native code lands.

## How it was measured

A generated checkout and record, written by
[`distill-corpus.mjs`](../../../packages/sense/scripts/distill-corpus.mjs)
through the repository's own writers, so the record is what a run writes:

```bash
node --max-old-space-size=16384 packages/sense/scripts/distill-corpus.mjs \
  --out <dir> --scale 1 [--hub 300]
```

It is deterministic for a seed, so one corpus served both builds.

At `--scale 1` it holds about 30k test files, 110k modules and 360k cases; each
test file imports a module of its package and, half the time, another package's
barrel. `--hub N` adds a chain of `N` modules, each importing the next, that
every test file imports at its head: a test helper over a deep stack, which
cases rarely enter. With no hub, the corpus has no stack deeper than a package
and nothing every test file loads.

Each command ran three times on the base, commit `9ea33e20c`, and on the
branch, from two separate builds, on an M4 Max with 64 GB and Node 24. Wall
time and peak RSS are `/usr/bin/time -l`'s `real` and `maximum resident set
size`; the figures below are rounded. Across three runs the spread was within a tenth.

```bash
/usr/bin/time -l node packages/cli/dist/bin.js distill --root <dir>/repo \
  --execution <dir>/record.bin [--from <dir> | --file <path>] [--format json|jsonl]
cmp base.out branch.out
```

The branch also charges a run at load differently, and none of the corpus's
outputs moved with it. Every output compared equal byte for byte with `cmp`:
every command on the corpus without a hub, including `--file` in text, and json and jsonl with the
hub. Text with the hub was not compared: the base takes about as long as its
json, a quarter of an hour, and the text is written from the same answer.

## What it cost

Without a hub:

| Command | Base | Branch |
| --- | --- | --- |
| whole suite, json | ~45 s, ~3.5 GB | ~2.5 s, ~1.5 GB |
| whole suite, jsonl | ~13 s, ~1.5 GB | ~0.9 s, ~0.9 GB |
| whole suite, text | ~45 s, ~3 GB | ~2.5 s, ~1.5 GB |
| `--from` one package | ~4 s, ~1.8 GB | ~1.5 s, ~1 GB |
| `--file`, a file with modules no case entered | ~4 s, ~1.8 GB | ~1.4 s, ~1 GB |
| `--file`, a file with none | ~3 s, ~1.5 GB | ~0.4 s, ~0.6 GB |

With a 300-module hub, where the base ran once per command:

| Command | Base | Branch |
| --- | --- | --- |
| whole suite, json | ~13 min, ~4.3 GB | ~3 s, ~1.9 GB |
| whole suite, jsonl | ~5 min, ~1.8 GB | ~1.1 s, ~1.1 GB |

The hub is the dimension that blows the base up: it adds 300 modules to every
test file's reading, almost none of them entered, and the base walked the graph
from each test file to each one. At a tenth of the scale the base's whole-suite
json went from about 4 s with no hub to about 11 s with 300 and 13 s with 1,000,
and the branch stayed under half a second.

## What native reading buys, and what the walk buys

Two costs are in the base, and they are separate. One is the walk to each
unentered module's import. The base built a dominator tree per test file too;
what grew with the hub was the work around it. Each edge it followed asked the
imported module's loaders whether they held the test file, a list as long as the
test files that load it, which for a hub is all of them; and each ancestor's
ways in were filtered by climbing the dominator chain again, quadratic in the
stack's depth. The addon keeps a test file's loads as a set, tests dominance by
the tree's pre- and postorder, and carries the owner down the tree once: linear
in the edges the test file followed. The other cost is the read: decoding every
crossing of the record into an object, which the corpus without a hub pays
alone.

The corpus without a hub has no deep stack and no module every test file loads,
so the walk is not where its time goes, and it still goes from about 45 s to
about 2.5 s in json. That gap is the read and the decode, and an algorithmic fix
to the walk in TypeScript leaves it standing: the base's no-hub figures are the
floor such a fix would reach on the hub corpus. The linear walk buys the hub's
growth, from about 45 s to about 13 min at full scale; reading natively buys the
rest, from about 45 s to under 3 s. The base with only the walk fixed in
TypeScript was not built and measured: its floor is measured already, and that
floor is what this change is argued against.

## Where the branch's time goes

Inside the process, on the corpus without a hub, the addon's read of the record
(the coverage rows and the case index, decoded once) takes about 0.2 s, and the
walk over every test file without the graph about 0.5 s, at about 850 MB
resident. Reading a test file once the record is read is under a millisecond.

A `--file` reading opens the whole record, about 0.2 s, because a record does
not index its rows by test file; with the cases decoded for the answer and the
process's start, that is the 0.4 s of a file with nothing unentered. A file with
modules no case entered also reads the file graph to name the import behind
each one, about a second more; a file with none skips it.

The whole suite in jsonl reads no graph: its rows carry no import. Between it
and json, about 1.7 s and 0.6 GB, are the file graph, read and flattened for the
addon, the walk to each unentered module's import, and about 100 MB of answer
serialized.

## What the corpus does not model

The real suite that did not finish was not read here, and its figures are not
published. The corpus does not model mocks, setup files that import the
application, re-exports across packages beyond one barrel each, or the spread of
cases over regions of a real suite. The hub reproduces the shape of the blow-up,
a deep shared stack every test file loads and few cases enter, not the real
suite's exact cost.
