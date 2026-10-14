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

A generated checkout and record, through the repository's own writers, so the
record is what a run writes:

```bash
node --max-old-space-size=16384 generate.mjs --sense <checkout>/packages/sense \
  --out <dir> --scale 1 [--hub 300]
```

At `--scale 1` it holds about 30k test files, 110k modules and 360k cases; each
test file imports a module of its package and, half the time, another package's
barrel. `--hub N` adds a chain of `N` modules, each importing the next, that
every test file imports at its head: a test helper over a deep stack, which
cases rarely enter.

Each command ran three times on the base and on the branch, from two separate
builds, on an M4 Max with 64 GB and Node 24. Wall time and peak RSS are
`/usr/bin/time -l`'s `real` and `maximum resident set size`; the figures below
are rounded. Across three runs the spread was within a tenth, except the
branch's json with a hub, whose first run, on a cold file cache, was the slowest.

```bash
/usr/bin/time -l node packages/cli/dist/bin.js distill --root <dir>/repo \
  --execution <dir>/record.bin [--from <dir> | --file <path>] [--format json|jsonl]
cmp base.out branch.out
```

Every output, on both corpora, compared equal byte for byte with `cmp`.

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
| whole suite, json | ~13 min, ~4.3 GB | ~6–10 s, ~2–2.5 GB |
| whole suite, jsonl | ~5 min, ~1.8 GB | ~2.3 s, ~1.1 GB |

The hub is the dimension that blows the base up: it adds 300 modules to every
test file's reading, almost none of them entered, and the base walked the graph
from each test file to each one. At a tenth of the scale the base's whole-suite
json went from about 4 s with no hub to about 11 s with 300 and 13 s with 1,000,
and the branch stayed under half a second.

## Where the branch's time goes

Inside the process, on the corpus without a hub, the addon's read of the record
(the coverage rows and the case index, decoded once) takes about 0.2 s, and the
walk over every test file without the graph about 0.5 s. Reading a test file
once the record is read is under a millisecond. The rest of a `--file` reading
that has modules no case entered, about a second, is reading the file graph to
name the import behind each one; a file with none skips it. The rest of a whole
suite in json is that graph and serializing about 100 MB of answer.

## What the corpus does not model

The real suite that did not finish was not read here, and its figures are not
published. The corpus does not model mocks, setup files that import the
application, re-exports across packages beyond one barrel each, or the spread of
cases over regions of a real suite. The hub reproduces the shape of the blow-up,
a deep shared stack every test file loads and few cases enter, not the real
suite's exact cost.
