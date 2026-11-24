# A native launcher leaves the index work

**Date:** 2026-11-24

The first spike for [#1766](https://github.com/Variance-Authority/variance-authority/issues/1766),
tracked as [#1800](https://github.com/Variance-Authority/variance-authority/issues/1800),
answered Kibana's `Button` question without Node. Its complete 858-byte answer
matched the Node CLI byte for byte on the same snapshot. Across 25 warm
direct-process runs the native example averaged 135.0 ms and Node averaged
455.6 ms, a 70% reduction in mean elapsed time. Index opening and declaration
preparation accounted for nearly all of the timed work inside the native probe.

This was a development probe, not a production native command. It reused
the index opener and `declared_of` from the addon crate. Adding `rlib` beside
`cdylib` let the example link that existing implementation; it did not separate
the core from NAPI. A feature gates the probe out of the normal addon. Its
temporary formatter supports top-level private declarations only and refuses
nested, member, unread, empty and truncated results. The harness compares the
whole answer before it starts timing. The probe shares the checked help header
decoder and checks the help store's checkout and the digest of the manifest
read by the index. Pairing Kibana's index with another checkout's help store
exits 2 before writing an answer. Exports, aliases and dependency answers
remain the Node command's work.

## Measurement

Machine: Apple M4 Pro, 14 cores, macOS Darwin 25.6.0 arm64. Node 24.22.1,
Rust 1.98.1, hyperfine 2.0.0, ripgrep 15.2.0. Load averages before the batch
were 5.90, 7.40 and 8.57. The native probe was built from `de56c44ca`.
The Node CLI used the same behavior as `3534ef1b8`.
Kibana was `b02eeffa0a96446711acb57a189990d76a939d04`, indexed with that
built CLI: 116,528 source files. The default cache in the fresh Kibana checkout
contained one generated source index. Node resolved it from the benchmark's
working directory, and the probe received that file's path. The index stayed
in place through the batch. Each call started a fresh process with warm
filesystem caches.

Hyperfine ran one process at a time, five warmups then 25 measured runs for
each command, with `--shell none`. [The samples](0080-native-symbol-spike.json)
include the spread and mean peak resident memory.

| Command | Mean ± standard deviation | Median | Mean peak RSS |
| --- | --- | --- | --- |
| native private `Button` answer | 135.0 ± 4.0 ms | 135.7 ms | 306.9 MiB |
| Node `ask symbol --name Button` | 455.6 ± 17.1 ms | 453.3 ms | 526.3 MiB |
| `rg -n -F --glob '*.{ts,tsx,js,jsx}' Button .` | 5861.8 ± 204.7 ms | 5924.9 ms | 12.1 MiB |

The two symbol rows answer the same question. `rg` reads source text and
prints matching lines. Its result measures a separate workload.

FFF was not timed. Its [upstream interface](https://github.com/dmtrKovalenko/fff#what-is-fff-and-why-use-it-over-ripgrep-or-fzf)
is a resident library/MCP service, not an equivalent one-shot CLI. Restarting
that server for each sample would measure the wrong workload. A future
comparison would need a separate resident-query experiment for both tools.

One separately instrumented native invocation recorded help-store opening
23.7 ms, source-index opening 74.7 ms, declarations 44.3 ms and rendering
0.011 ms. Of the 44.3 ms declaration stage, 35 ms went to sorting the active
files and joining them to their parses. The probe opens the help store for
the timestamp and generation, and the existing reader validates broad structures. The
source-index reader loads the chain before the declaration query runs. These
costs give #1761, #1762 and #1763 stages to measure separately.

## Reproduce

From this repository, install and build normally, then build the example:

```sh
cargo build --release --example symbol-spike --features symbol-spike \
  --manifest-path packages/sense/native/Cargo.toml
```

In a Kibana checkout at the revision above, run the built Node CLI's
`index --wait`. Back in this repository, pass that checkout and the resulting
`source-index.bin` path to the harness, together with a hyperfine executable
and an output path outside the repository:

```sh
node tools/native-symbol-spike.mjs "$KIBANA" "$SOURCE_INDEX" \
  "$HYPERFINE" /tmp/native-symbol-results.json
```

The help store must be the matching `${SOURCE_INDEX}.help.bin`. Run without
concurrent builds or suites. For diagnostic stages, set
`VARIANCE_AUTHORITY_SPIKE_STAGES=1` and `VARIANCE_AUTHORITY_INDEX_STAGES=1`
when calling the example directly with `<checkout> <index> <help-store> Button`.

## What this establishes

The example returned the same answer in 30% of the Node CLI's mean time and
used about 307 MiB of resident memory. This comparison combines process startup
with the other work the specialized example skips. Use 15 ms as a reference
and measure future gains against unchanged answers. The next experiment will
test selective index reads and prepared lookup. General symbol behavior,
native search/classify/uses/grep/covering, a shared command table, core/NAPI
separation and per-platform installation still require their own implementation
and acceptance evidence.
