# Native code

Installing [Variance Authority](README.md), a visual regression system you run
yourself, does not need a compiler. There is no `cargo`, no `rustc`, no
`node-gyp` and no build step on install: the compiled code arrives as prebuilt
binaries that your package manager downloads for your platform, and no package
in this product runs an install or postinstall script.

This page says what lands on your disk, on which platforms, what your CI image
needs, and what happens on a machine where a binary does not arrive.

## What installs

Five pieces of compiled code sit under a run, and four of them arrive with the
install.

| Piece | What it does | How it arrives |
|---|---|---|
| [oxc](https://oxc.rs) — `oxc-parser`, `oxc-resolver` | parses and resolves every module in the [source index](source-index.md) | prebuilt `.node` addon, chosen by a per-platform optional dependency of each package |
| the scanner in [`@variance-authority/sense`](../packages/sense) | reads, parses, resolves and records a whole cold checkout without returning a syntax tree to JavaScript | the same way: one optional dependency per platform, named for the platform it carries |
| `sharp`, through [`@variance-authority/png-sharp`](../packages/png-sharp) | decodes screenshots for the raster comparison | the same way: `sharp` resolves one prebuilt libvips addon for your platform |
| zstd, SHA-256 | compresses the selection index, digests documents | already in Node, as `node:zlib` and `node:crypto` |
| Chromium | paints the pages you compare | `npx playwright install chromium`, a separate step you already run |

`@variance-authority/cli` depends on `@variance-authority/png-sharp` outright,
so installing the CLI installs `sharp`. What is optional per platform is the
binary underneath it, not the package. If you depend on the comparison packages
directly instead of the CLI, that choice is yours to make:
`@variance-authority/png` alone needs only `Buffer`, and `png-sharp` is a
separate install.

Measured on macOS arm64, the compiled addons come to roughly 25 MB —
libvips is 15 MB of it, the two oxc bindings are about 1.5 MB each, and the
scanner is 3.4 MB.
Your package manager unpacks one platform's binaries, not the matrix.
Playwright's Chromium dwarfs all of it at a few hundred megabytes, and it is
downloaded into Playwright's own cache rather than into `node_modules`.

Nothing here is WebAssembly. Two wasm PNG decoders were measured against the
pure-JavaScript one and both were slower, so there is no portable-and-fast
middle option to reach for.

### Platforms and architectures

The third-party addons ship binaries for macOS on arm64 and x64, Linux on x64
and arm64 against both glibc and musl, and Windows on x64 and arm64. oxc also
publishes FreeBSD x64, 32-bit Windows, and Linux on ppc64, riscv64 and s390x.

The scanner ships three: **macOS arm64**, **Linux x64 against glibc**, and
**Windows x64**. That covers an Apple Silicon laptop, a GitHub or Bitbucket
Linux runner, and a Windows desktop, and it is a short list because it can
afford to be — see *When a binary does not arrive* below.

One binary per platform, built for the oldest machine that platform runs on. On
Apple Silicon that is the M1 instruction set, and an M4 loads the same file:
what a faster machine gives the scan is cores, which it reads at runtime.

`oxc-parser`, `oxc-resolver` and `sharp` each publish a musl build for x64 and
arm64, so on Alpine and other musl images the usual failure — an addon that
resolves to a glibc binary and dies at load — does not apply to these three.
Whether Playwright's Chromium runs on your musl image is Playwright's question,
not this one; check it before you build the image around it.

The Node floor is **22.15**, declared by the CLI. It is that exact version
rather than 22 because `zlib.zstdCompressSync` landed there, and the selection
index is stored in zstd-compressed columns. No upper bound is declared.

### CI images

Your image needs Node 22.15 or later, your installed dependencies, and a
Chromium. The addons come down with the install like any other package, so
nothing in this product is built inside the image.

Chromium is the one thing you add deliberately. It is Playwright's browser, it
is what paints the pages a run compares, and it is installed the same way
whether or not you use Variance Authority's Playwright integration. If your
suite already runs `npx playwright install chromium`, you are done.

One thing your image does decide: pixels made on different machines are not
comparable to each other, so where you paint is a choice with consequences.
[Placement](placement.md) covers it.

### When a binary does not arrive

Two installs skip optional dependencies: `npm install --omit=optional`, and a
lockfile resolved on one platform and installed on another without that
platform's entries in it. Both leave the JavaScript wrappers in place and the
`.node` files missing, and what that costs is not the same for each addon:

- **Decoding degrades.** The default `decoder: "auto"` catches the failed load
  and uses `pngjs` — the same verdicts, a slower run. `decoder: "sharp"` fails
  the run by name and says the addon would not load.
- **Parsing does not degrade.** oxc has no fallback, so a command that builds
  the source index fails rather than building a smaller one.
- **Scanning degrades.** The TypeScript scanner is the implementation of record
  and the addon is an acceleration of it, held to the same answers by
  differential tests. A machine outside the three platforms — a Linux arm64
  runner, an Alpine image, an Intel Mac — builds the same source index from the
  same checkout, and pays what the TypeScript scan costs to build it.

If you want the binaries, install without `--omit=optional` and resolve your
lockfile so it carries entries for every platform you install on. If you want
the pure-JavaScript decoder on purpose, say so with `decoder` rather than by
withholding an install.

## Choosing the PNG decoder

The PNG decoder is the one piece you choose. `decoder` is a top-level key in
`variance.config.json` and takes three values:

```json
{
  "decoder": "auto"
}
```

- **`auto`** (the default) prefers `sharp` and silently keeps `pngjs` when the
  addon will not load — on a platform its binaries do not cover, or inside a
  bundle that cannot carry one. A machine without the binary produces the same
  verdicts more slowly, never no verdicts.
- **`pngjs`** pins the pure-JavaScript decoder, so a run cannot get faster or
  slower because a machine happened to have a binary.
- **`sharp`** fails loudly when the addon is missing, which is what you want on
  a build machine you configured on purpose.

Both decoders are held to producing byte-identical RGBA by a test, so this
setting changes what a run costs and never what it decides. What it costs is
not marginal: decoding is 90% of a raster comparison, and libvips decodes on
libuv's threadpool, so images decoded concurrently leave the event loop
entirely. That makes the decoder the largest single lever on how long a red run
takes.

**Parsing has no opt-out, and that is a position rather than an omission.** oxc
is how the source index is built; a platform outside its matrix does not get a
slower index, it gets no index. The matrix above is wide enough that the trade
is worth it, and a fallback parser would be a second implementation of the
thing that decides what your tests touch.
