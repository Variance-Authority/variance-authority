# Where the native code is

The short answer to *why isn't this written in Rust* is that a lot of it already
is, and none of the parts that are got there by being rewritten.

Variance Authority reads source, renders pages, compares images and writes an
index of what every test touched. Those are the workloads people expect to be
native, and each one already runs on compiled code that somebody else maintains:

- **Parsing.** [oxc](https://oxc.rs) reads every module. It is Rust, and the
  syntax tree crosses into JavaScript out of the parser's own buffer rather than
  through a serialized handoff, because the handoff cost as much as the parse.
- **Hashing.** Digests come from the platform's SHA-256. A hand-written one
  exists for the half of the system that runs inside a page, where no such
  primitive is reachable, and nothing outside a page uses it.
- **The selection index.** Columns are compressed with zstd, at one level for
  the integer runs and another for the string dictionary, because they are
  different data and a single level is right for neither.
- **Decoding screenshots.** Chromium decodes a PNG about twice as fast as the
  JavaScript decoder, and a run already holds a Chromium. The fastest decoder
  available was the browser the pixels came from.

What is left in TypeScript is the part that encodes policy: which regions of a
file are worth a probe, when a difference is a finding rather than an engine, how
a subject's identity survives a component moving. That code changes when the
product's mind changes, which is often, and it is read by people deciding whether
they agree with it.

## The measurement, not the opinion

A workload here moves to compiled code when a recorded benchmark says it should,
and the benchmark is kept with the number it produced and the question it
answered. The scripts are in the repository and run on any checkout.

The result that keeps coming back is worth stating, because it is the one people
are surprised by: **the crossing costs what the work costs.** Every stage ends by
handing a large object graph to a JavaScript caller, so moving the stage into
another language relocates that boundary rather than removing it. Where a stage
looked expensive, the profile has more often named the shape of the data than the
speed of the language — a format that made a reader decode everything to reach
anything, or an index rebuilt in full to change ten files in it. Reading a
snapshot's columns lazily, and merging a run into them without materializing the
rest, took that path from 1855 ms to 616 on a twenty-thousand-module index. No
rewrite reaches that, because the work is not performed faster; it is not
performed.

There is one shape the argument does not cover, and it is worth naming because
it is where the next piece of compiled code will come from. A stage that returns
a string — source in, instrumented source out — hands back something a native
caller can keep. Nothing crosses but bytes, the boundary is priced at almost
nothing, and the reason to stay in JavaScript disappears. Test runners are moving
their transpilers to compiled code, which means the transform is exactly that
shape, and the threshold that matters there is not a number of milliseconds but a
share of what the runner around it spends.

So the position is narrower than *rewrite it in Rust* and narrower than *don't*:
compiled code where the crossing is cheap and the work is bulk, JavaScript where
the crossing is the work and the rules change with the product. Both halves are
claims with an expiry date, and the benchmarks that decide them are in the
repository so they can be checked rather than believed.
