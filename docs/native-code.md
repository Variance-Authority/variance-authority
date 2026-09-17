# Native code

Installing [Variance Authority](README.md) does not need a compiler. There is no `cargo`, no
`rustc`, no `node-gyp` and no build step on install: the compiled code arrives as
prebuilt binaries that your package manager downloads for your platform, and no
package in this product runs an install or postinstall script.

This page says what lands on your disk, on which platforms, what your CI image
needs, and what you can turn off. The argument for why the rest is TypeScript is
at the end.

## What installs

Four pieces of compiled code sit under a run, and three of them arrive with the
install.

| Piece | What it does | How it arrives |
|---|---|---|
| [oxc](https://oxc.rs) — `oxc-parser`, `oxc-resolver` | parses and resolves every module in the [source index](source-index.md) | prebuilt `.node` addon, an optional dependency per platform |
| `sharp` — via [`@variance-authority/png-sharp`](../packages/png-sharp) | decodes screenshots for the raster comparison | prebuilt `.node` addon, an optional dependency per platform |
| zstd, SHA-256 | compresses the selection index, digests documents | already in Node, as `node:zlib` and `node:crypto` |
| Chromium | paints the pages you compare | `npx playwright install chromium`, a separate step you already run |

Nothing here is WebAssembly. Two wasm PNG decoders were measured against the
pure-JavaScript one and both were slower, so there is no portable-and-fast
middle option to reach for.

### Platforms and architectures

The addons ship binaries for macOS on arm64 and x64, Linux on x64 and arm64
against both glibc and musl, and Windows on x64 and arm64. oxc also publishes
FreeBSD x64, 32-bit Windows, and Linux on ppc64, riscv64 and s390x.

**Alpine and other musl images are covered.** `oxc-parser`, `oxc-resolver` and
`sharp` each publish a musl build for x64 and arm64, so the usual musl failure —
an addon that resolves to a glibc binary and dies at load — does not apply to
these three.

The Node floor is **22.15**, declared by the CLI. It is that exact version rather
than 22 because `zlib.zstdCompressSync` landed there, and the selection index is
stored in zstd-compressed columns.

### CI images

Your image needs Node 22.15 or later, your installed dependencies, and a
Chromium. The addons come down with the install like any other package, so
nothing in this product is built inside the image.

Chromium is the one thing you add deliberately. It is Playwright's browser, it is
what paints the pages a run compares, and it is installed the same way whether or
not you use Variance Authority's Playwright integration. If your suite already
runs `npx playwright install chromium`, you are done.

One thing your image does decide: pixels made on different machines are not
comparable to each other, so where you paint is a choice with consequences.
[Placement](placement.md) covers it.

## What you can turn off

The PNG decoder is the one piece you choose. `decoder`, in
`variance.config.json`, takes three values:

- **`auto`** (the default) prefers `sharp` and silently keeps `pngjs` when the
  addon will not load — on a platform its binaries do not cover, or inside a
  bundle that cannot carry one. A machine without the binary produces the same
  verdicts more slowly, never no verdicts.
- **`pngjs`** pins the pure-JavaScript decoder, so a run cannot get faster or
  slower because a machine happened to have a binary.
- **`sharp`** fails loudly when the addon is missing, which is what you want on a
  build machine you configured on purpose.

Both decoders are held to producing byte-identical RGBA by a test, so this
setting changes what a run costs and never what it decides.

**Parsing has no opt-out, and that is a position rather than an omission.** oxc
is how the source index is built; a platform outside its matrix does not get a
slower index, it gets no index. The matrix above is wide enough that the trade is
worth it, and a fallback parser would be a second implementation of the thing
that decides what your tests touch.

## Why the rest is TypeScript

Your toolchain is already compiled. esbuild went to Go, and then swc, Rolldown,
Turbopack, Biome and oxlint went to Rust, so the things that read every file in
your repository are native and the benchmark on their front page says by how
much. A tool that reads every file in your repository and is written in
TypeScript is, in that company, one that has not got round to it yet.

So the question is fair, and the short answer to *why isn't this written in
Rust* is that a lot of it already is, and none of the parts that are got there
by being rewritten. Each one is compiled code somebody else maintains, reached
for because a measurement said to:

- **Parsing.** oxc reads every module. The syntax tree crosses into JavaScript
  out of the parser's own buffer rather than through a serialized handoff,
  because the handoff cost as much as the parse.
- **Hashing.** Digests come from the platform's SHA-256.
- **The selection index.** Columns are compressed with zstd, at one level for the
  integer runs and another for the string dictionary, because they are different
  data and a single level is right for neither.
- **Decoding screenshots.** libvips decodes on libuv's threadpool, so images
  decoded concurrently leave the event loop entirely. Decoding is 90% of a
  raster comparison, which makes it the largest single lever on how long a red
  run takes.

What is left in TypeScript is the part that encodes policy: which regions of a
file are worth a probe, when a difference is a finding rather than an engine, how
a subject's identity survives a component moving. That code changes when the
product's mind changes, which is often, and it is read by people deciding whether
they agree with it.

### The measurement, not the opinion

A workload here moves to compiled code when a recorded benchmark says it should,
and the benchmark is kept with the number it produced and the question it
answered. The benchmark scripts are in the
[public repository](https://github.com/Variance-Authority/variance-authority)
and run on any checkout of it, so these are claims you can re-run rather than
claims you have to accept.

The result that keeps coming back is worth stating, because it is the one people
are surprised by: **the crossing costs what the work costs.** Every stage ends by
handing a large object graph to a JavaScript caller, so moving the stage into
another language relocates that boundary rather than removing it. Where a stage
looked expensive, the profile has more often named the shape of the data than the
speed of the language — a format that made a reader decode everything to reach
anything, or an index rebuilt in full to change ten files in it. Reading a
snapshot's columns lazily, and merging a run into them without materializing the
rest, took the largest single win on that path, and no rewrite reaches it:
the work is not performed faster, it is not performed.

Both halves of that are claims with an expiry date. The timings behind them are
on one page: [what a run costs](performance.md).
