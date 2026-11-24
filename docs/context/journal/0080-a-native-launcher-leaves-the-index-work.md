# A native launcher leaves the index work

**Date:** 2026-11-24

The first spike for [#1766](https://github.com/Variance-Authority/variance-authority/issues/1766),
tracked as [#1800](https://github.com/Variance-Authority/variance-authority/issues/1800),
answered Kibana's `Button` question without Node. Its complete 858-byte answer
matched the same-build Node CLI byte for byte. Across 25 warm direct-process
runs the native example averaged 127.8 ms and Node averaged 442.3 ms, a 71%
reduction in mean elapsed time for this case. Index opening and declaration
preparation accounted for nearly all of the timed work inside the native probe.

This was a development probe, not a production native command. It reused
`open_index` and `declared_of` from the addon crate. Adding `rlib` beside
`cdylib` let the example link that existing implementation; it did not separate
the core from NAPI. A feature gates the probe out of the normal addon. Its
temporary formatter supports top-level private declarations only and refuses
nested, member, unread, empty and truncated results. The harness compares the
whole answer before it starts timing, so an unsupported or differing answer
cannot become a speed result. Exports, aliases and dependency answers remain
the Node command's work.

## Measurement

Machine: Apple M4 Pro, 14 cores, macOS Darwin 25.6.0 arm64. Node 24.22.1,
Rust 1.98.1, hyperfine 2.0.0, ripgrep 15.2.0. Load averages before the batch
were 5.34, 8.49 and 8.69. The runtime base was `3534ef1b8`, with the gated
example in this change; the production Node implementation was unchanged.
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
| native private `Button` answer | 127.8 ± 3.7 ms | 127.9 ms | 306.8 MiB |
| Node `ask symbol --name Button` | 442.3 ± 21.2 ms | 436.7 ms | 526.2 MiB |
| Node `ask search --query recalculation` | 534.1 ± 193.0 ms | 494.0 ms | 521.6 MiB |
| Node `ask classify --query recalculation` | 591.9 ± 20.7 ms | 587.0 ms | 555.2 MiB |
| `rg -n -F --glob '*.{ts,tsx,js,jsx}' Button .` | 5577.6 ± 271.7 ms | 5643.4 ms | 12.1 MiB |

Only the two symbol rows answer the same question. Search and classify are
Node controls, with no native equivalent in this spike. Search had a 1.45 s
outlier; the samples are retained rather than silently excluding it. `rg`
reads source text and prints matching lines; it neither reads the same index
nor returns the same answer. These timings do not rank the tools' search
quality or establish a general speed ratio.

FFF was not timed. Its [upstream interface](https://github.com/dmtrKovalenko/fff#what-is-fff-and-why-use-it-over-ripgrep-or-fzf)
is a resident library/MCP service, not an equivalent one-shot CLI. Restarting
that server for each sample would measure the wrong workload. A future
comparison would need a separate resident-query experiment for both tools.

One separately instrumented native invocation recorded help-store opening
22.0 ms, source-index opening 76.6 ms, declarations 47.7 ms and rendering
0.024 ms. These are diagnostics from another invocation, not shares of the
127.8 ms mean. The probe reads the help store to obtain the snapshot timestamp,
and the current reader still validates broad structures. Source-index opening
also reads the chain before the declaration query runs. This identifies work
for #1761, #1762 and #1763; it does not establish which replacement will win.

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
`VARIANCE_AUTHORITY_SPIKE_STAGES=1` when calling the example directly with
`<checkout> <index> <help-store> Button`; leave it unset for timings.

## What this establishes

The example returned the same answer in 29% of the Node CLI's mean time and
used about 307 MiB of resident memory. This comparison combines process startup
with the other work the specialized example skips. Use 15 ms as a reference
and measure future gains against unchanged answers. The next experiment will
test selective index reads and prepared lookup. General symbol behavior,
native search/classify/uses/grep/covering, a shared command table, core/NAPI
separation and per-platform installation still require their own implementation
and acceptance evidence.
