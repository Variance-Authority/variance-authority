# ADR-0074 — one reader per tree-sitter language, and it is the addon's

**Status:** accepted
**Date:** 2026-09-25
**Supersedes:**
[ADR-0066](0066-a-language-is-a-reader-not-a-sense.md) §4, "The grammars are
WASM on the JavaScript side", and for Python, Rust, Java, Kotlin and Swift the
clause in [ADR-0065](0065-source-scanning-is-one-native-side.md) that
[ADR-0073](0073-one-module-reader.md) already set aside for modules.
**Relates to:**
[`packages/sense/src/record.ts`](../../../packages/sense/src/record.ts),
[`packages/sense/native/src/languages/mod.rs`](../../../packages/sense/native/src/languages/mod.rs),
[`packages/sense/native/build.mjs`](../../../packages/sense/native/build.mjs)

## Context

After ADR-0073 the module reader was one, and the five tree-sitter languages
were still two. Each had a JavaScript reader — `web-tree-sitter` walking a WASM
grammar node by node — and the same grammar compiled into the addon.
`accelerated()` in `record.ts` chose between them.

The question was whether the JavaScript side did anything besides stand in for
the addon. It did not:

- `accelerated()` took the native answer whenever the addon claimed the
  language. The JavaScript reader ran in three cases: no addon, an addon built
  without the grammars, and a native call that threw — caught with no word.
- Nothing imported `readPython`, `readRust`, `readJava`, `readKotlin` or
  `readSwift` except `record.ts` and each language's own unit test.
- `targetsOf`, the WASM read of `Package.swift`, ran only when the addon had no
  `swiftTargets`.

And it was not an oracle either, because nothing compared the two. The unit
tests in `python.test.ts`, `rust.test.ts`, `jvm.test.ts` and `swift.test.ts`
called the JavaScript readers directly. The native readers — the ones every
supported platform ran — were held by no fixture in this package; only
`native-grammars.check.ts` asked that the method exist. The tests pinned the
copy that ran least.

The JavaScript side also carried a hazard of its own. The WASM Swift grammar
aborts Node 24 and 25 with a V8 Zone OOM at parse time, and `loadGrammars()`
initialised every grammar before a scan opened its first file.

## Decision

**Each tree-sitter language has one reader, and it is the grammar linked into
the addon.** `record.ts` calls `readLanguage` for all five. `Package.swift` is
read by `swiftTargets`.

- A machine without the addon fails the read and names `nativeRefusal()`, the
  way ADR-0073 fails a module read.
- A binary built without the grammars — `build.mjs` retries with
  `--no-default-features` when they do not compile — answers `null`. The file
  is then recorded **unknown**, with the missing grammars as the reason, and is
  never read some other way and never recorded as edgeless. Its
  `Package.swift` declares no targets, so every Swift file falls to the
  conventional `Sources/<name>` layout.

Removed: `grammar.ts`; the readers in `python.ts`, `rust.ts`, `jvm.ts` and
`swift.ts`, which keep only resolution; `web-tree-sitter` and the
`tree-sitter-java`, `tree-sitter-python`, `tree-sitter-rust` and
`tree-sitter-wasms` optional dependencies. The four language tests keep every
assertion and now read through the addon, so the reader they hold is the one
that runs.

Each `.ts` file still carries the argument for its language — what counts as a
guess, what is unknown — and each reader in `native/src/languages/` points to
it.

## What the conversion found

Moving the tests onto the addon failed two of them on the first run, both
Kotlin: a file's package and its imports. The native Kotlin reader had never
read either on any platform.

The addon links `tree-sitter-kotlin-ng`, and the WASM package shipped fwcd's
`tree-sitter-kotlin`. Those are two grammars with different node names. The
native reader in `jvm.rs` was written against the WASM names, so it asked for
`import_header`, `import_list`, `import_alias` and `simple_identifier` where
kotlin-ng answers `import`, top-level children, a bare `identifier` and
`qualified_identifier`. It matched nothing,
and returned no request and no unknown. On every supported platform, every
Kotlin file was recorded with its package and imports missing, as a file that
asks for nothing. That is the edgeless record this package is built to refuse,
and the JavaScript tests could not see it because they ran the other grammar.

The same walk had never published a top-level `typealias` or `val`, under
either grammar. `jvm.rs` now walks kotlin-ng's shapes, and `jvm.test.ts` holds
a package, an alias, a wildcard, a `typealias` and a `val`.

**What it cost:** on every supported platform, every Kotlin file was a node
with no edges, so the graph never carried a change in one Kotlin file to the
files that import it or share its package.

## Cost

- **A from-source build without a C toolchain for the grammars loses five
  languages.** Before, it read them through WASM at a lower speed; now their
  files are unknown. Unknown is traversed as changed, so selection over-reaches
  on them rather than misses. The four prebuilt platforms always ship the
  grammars, and `native-grammars.check.ts` keeps the fallback build answering
  `null` rather than missing the method.
- **One implementation, held by fixtures.** A change to a reader is checked
  against the tests in `<language>.test.ts` and the suite, not a second copy.
  Before, it was checked against neither: the tests ran the copy that did not
  ship.
- **Gains.** Five readers and their grammar loader are gone from the
  package, along with a 4.7 MB runtime, the per-language WASM downloads, and
  an `await` on the scan's path. The Swift WASM abort on Node 24 and 25 is no longer reachable
  from a scan.
