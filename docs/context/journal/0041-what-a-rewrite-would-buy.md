# 0041 — what a rewrite would buy

"Performance matters, so rewrite it in Rust" is a position. `sense` reads a
checkout, cuts every module into regions, and writes an index; at two hundred
thousand files the cost of doing that is a real question, and the answer a
rewrite offers is only as large as the share of the clock it can actually reach.
[ADR-0004](../adr/0004-defer-native-acceleration.md) says the gate is a
measurement rather than an opinion, and its two gates were written for the
comparison path — normalization, diff, frequency rollup. Neither names `sense`.
So the record path needed its own reading before anybody could argue about it.

The reading is that two of the four stages are already between a third and a
half native, the two largest costs that *were* ours came back without anyone
writing Rust, and the single most expensive thing measured here is a Rust
component handing a large object graph to JavaScript.

## The reproduction

```bash
yarn workspace @variance-authority/sense build
```

```bash
yarn workspace @variance-authority/sense native
```

```bash
yarn workspace @variance-authority/sense coverage
```

```bash
yarn workspace @variance-authority/sense overhead
```

`native` profiles four stages and attributes self time by **ancestry**, not by
the name on the frame. That distinction is the whole method. Brotli surfaces as
`writeSync` and `close` with no url at all; what identifies it is that its parent
chain passes through `node:zlib`. Keyed on frame names, the largest native cost
in the encoder reads as half a per cent of it. Nothing is discarded except the
profiler's own `Profiler.stop`, which runs inside the measured window — a bucket
that quietly drops a dependency's JavaScript shrinks the denominator and
flatters whatever is left, and an earlier reading of this exact profile did
precisely that and put our share sixteen points too high.

The corpus is this repository's own product source for `instrument`, and the
same source repeated to twenty thousand modules for the rest, built by
`scripts/coverage-corpus.mjs` so that `native` and `coverage` cannot drift into
measuring two different repositories.

## Where the milliseconds are

```
569 modules, 1.8 MB of source, 18837 regions

instrument, 82 ms
     40 ms   48.6%  ours
     11 ms   13.4%  the parser
     11 ms   13.1%  SHA-256
     10 ms   12.1%  the parser's JavaScript
     10 ms   12.0%  V8 and the collector
  —————
          38.5%  already native, and out of a rewrite's reach
          61.5%  JavaScript, which is what one could reclaim

20000 modules, 662528 regions

encode, 1037 ms
    586 ms   56.5%  ours
    300 ms   28.9%  brotli
    114 ms   11.0%  V8 and the collector
     37 ms    3.5%  the Node runtime
  —————
          40.0%  already native

decode, 771 ms
    517 ms   67.0%  ours
    136 ms   17.7%  brotli
     83 ms   10.7%  V8 and the collector
  —————
          28.4%  already native

layer, 63 ms
     54 ms   85.8%  ours
      9 ms   14.2%  V8 and the collector
  —————
          14.2%  already native
```

The upper bound on a perfect rewrite is the second line of each block: every
statement we own replaced by one that costs nothing. `instrument` goes from
82 ms to 32, `encode` from 1037 to 415, `decode` from 771 to 219 — and those are
ceilings nobody reaches, since the collector keeps running and the compressor
keeps compressing. Two of the four stages are held down by a parser and a brotli
that are already compiled.

## Both of the large wins were ours to give away

```
the two decisions, over the same 1.8 MB
  SHA-256     68 MB/s portable   ->  1680 MB/s from node:crypto  (24.7x)
  transfer   139 ms serialized   ->   63 ms raw  (2.2x)
```

Neither is a rewrite. One is a call to an algorithm the platform already
compiled in; the other is an option on a parser this package already depended
on. Both are measured by the same script, because the path each replaced is
still in the tree and still runs.

**The hand-written SHA-256 was the largest single line in `instrument`.**
`core` implements the algorithm by hand for a stated reason: `propsDigest` runs
inside the rendering page, where `node:crypto` does not exist and
`crypto.subtle` is async ([`packages/core/src/format/sha256.ts`](../../../packages/core/src/format/sha256.ts)).
Nothing in `sense` runs in a page — it reads files, parses them and writes
records, in a Node process that has the same algorithm compiled in. So `sense`
takes its digests from the platform and keeps the shape from `core`, through
`digestOfSha256`, which owns the prefix and the truncation so a second place
cannot decide either. FIPS 180-4 admits one answer and `src/digest.test.ts`
holds the two implementations to it across the padding boundaries rather than
this paragraph asserting it.

**Then oxc's own JSON round trip was the largest.** The parser is Rust; the cost
was never the parse. By default it serializes the tree to JSON and the package's
own wrapper parses that JSON back into objects — work the tree has already had
done to it once. Raw transfer deserializes the same tree directly out of the
parser's buffer into the same plain objects, and
[`blocks.ts`](../../../packages/sense/src/instrument/blocks.ts) cannot tell which
one it was handed. The canary in `instrument.test.ts` compares the two trees
node for node and the two block sets region for region, because the option is
experimental upstream.

That second one is the finding worth carrying past this entry. In the profile
above, the parser's native time is 11 ms and the parser's JavaScript — the
deserialization of its output — is 10 ms. **Handing the tree over costs about
what producing it costs**, and on the serialized path it cost several times
more. Every stage measured here ends by giving a large object graph to a
JavaScript caller: 662,528 blocks out of `decode`, 18,837 regions out of
`instrument`. A rewrite does not remove that crossing. It moves the cost to the
boundary, which is the one place this repository has already measured it.

## What a rewrite cannot reach at all

The probe. [Journal 0027](0027-what-instrumentation-costs.md) records `o` = 1.00
against a 1.35 bar and the honest version of it — probed and unprobed are not
separable at that resolution. A probe is `counters[n]++` against a `Uint32Array`,
and it runs inside the user's own V8, in the user's own module graph, in the test
runner's process. There is no other side to move it to, and an increment into a
typed array is already what a compiler would emit.

This matters more than the stage timings, because the probe is the only part of
`sense` that runs on every test in every suite forever. The parts a rewrite could
touch run once per changed file.

## What is left, at scale

`instrument` is paid per changed file and nothing else: 0.14 ms a module here, so
a build that changed ten files spends under two milliseconds in it, and a first
pass over two hundred thousand files projects to about 29 seconds — of which a
perfect rewrite returns 18. That pass runs inside the bundler's worker pool,
across as many cores as the machine has, and happens once per checkout.

`encode`, `decode` and `layer` scale with the index rather than the change. The
20,000-module reading projects to roughly ten seconds of encode at 200,000, six
of it ours. That is the number worth attacking, and the honest thing to say about
it is that the attack is not a language. `decode`'s 517 ms is materializing
662,528 block objects for a caller that then reads a few hundred of them;
`layer`'s 54 ms is rebuilding a snapshot that differs from the previous one in
ten modules. Both are formats that make the reader pay for everything in order to
reach anything, and both get cheaper by being read lazily — after which there is
less JavaScript left to rewrite, not more.

## The gate

ADR-0004 stands unchanged, and nothing here fires it. G1 and G2 describe the
comparison path; the record path's reading is above, and it says that the
largest share any stage offers a rewrite is 86% of a 63 ms merge, while the two
stages that dominate a real run are already 40% and 28% native at their current
shape and lose most of their remainder to a format change rather than a
language.

The measurements that changed something were both of the same kind: a place
where this repository was doing by hand what the platform underneath it already
did. Those are worth looking for again before anything else. They cost a day and
they do not cost a second toolchain.
