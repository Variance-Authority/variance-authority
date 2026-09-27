# Selection reuse

Before a run does any work, something has to decide which UI states a code
change could have reached. This example makes that decision from the source
graph, then makes it twice more — warm from the index the first scan wrote, and
again after editing a file — so you can see what the second answer costs once
the first has been paid for.

Two words this page uses:

- A **subject** is one named UI state you asked for and can ask for again, under
  an id you choose. The demo has two, `story:catalog` and `story:account`.
- A **record** is one source file's resolved imports, as the scan stored them.
  The selection answer is computed from records, and a record survives until the
  content of its file changes.

## What it does

The demo builds a throwaway git checkout in your temp directory: 304 files under
`src/`, of which four decide the answer — `tokens.css`, `button.css` (which
imports it), `Button.tsx` (which imports `button.css`) and `Badge.tsx` (which
imports nothing). The other 300 are filler, so the timings below are not the
timings of four files.

It then scans that checkout three times — cold, warm from the index the cold
scan wrote, and again after editing `tokens.css` — asking each time which
subjects a change to `src/tokens.css` reaches. `story:catalog` is collected
because `Button` imports `button.css`, which imports the token; `story:account`
is skipped because `Badge` imports neither.

## Run it

You need a checkout, `yarn install`, `yarn build` (the demo imports the built
`@variance-authority/core` and `@variance-authority/sense`), `git` on your `PATH`,
and Node 22 or newer. The package is `private`; there is nothing to install from
npm.

From the repository root:

```bash
yarn workspace @variance-authority/example-selection-reuse demo
```

It prints, in full:

```text
CACHED SOURCE SELECTION — one changed token
  changed:  src/tokens.css
  collect:  story:catalog (reaches Button)
  skip:     story:account (does not reach Badge)

  cold scan:       56.7 ms
  warm scan:       24.5 ms
  after token edit: 33.5 ms
  speedup:         2.3×
  warm reuse:      304 records reused, 0 rebuilt
  selection agrees: yes
```

Those milliseconds are 304 files on an Apple M4 Max under Node 26.7; yours will
differ, and the ratio changes less than the absolute numbers do. A second run
here gave 64.8 ms cold and 28.8 ms warm — the same 2.3×.

Three hundred files is a demo, not a repository. At real scale,
`packages/sense/scripts/source-index.mjs` runs the same scan, and the table
below is that script on two public checkouts:
[Material UI](https://github.com/mui/material-ui) at `8f19b1009b`, scanning
`packages` and `docs/src`, and [Kibana](https://github.com/elastic/kibana) at
`df0daaddcc`, a monorepo of 1,488 packages, scanning `src`, `x-pack` and
`packages`. Both ran on the same Apple M4 Max as the demo, and each time is the
median of runs made for this page — three on Material UI, five on Kibana. The
pages under `docs/` time the same checkouts in runs of their own, and their
figures differ from these by up to 17% on a cold scan and 8% on a warm run.

| Checkout | Tracked paths | Records | Index on disk | Cold | Warm, nothing changed | Speedup |
| --- | --- | --- | --- | --- | --- | --- |
| Material UI | 41,171 | 25,117 | 11.0 MB | 671 ms | 283 ms | 2.4× |
| Kibana | 125,804 | 106,219 | 81.0 MB | 8,898 ms | 1,989 ms | 4.5× |

The larger repository changes where a warm run spends its time. On Material UI
the warm run splits about evenly between opening the index and scanning the
working tree, 137 ms and 146 ms. On Kibana, opening the 81.0 MB index takes
1,172 ms and the scan 803 ms, each the median of its own five timings, so the
two do not add up to 1,989.
[What a source scan costs](../../docs/performance.md) prices each part of the
scan on both checkouts.

The line to read is `304 records reused, 0 rebuilt`: the warm scan rebuilt
nothing and still gave the same two-subject answer as the cold one. After the
token edit it rebuilds only what the edit invalidated and answers the same way
again. The warm run on Kibana prints the same line at its own scale:
`106219 records reused, 0 rebuilt`.

## Scope

This is the source-graph half of a run: which subjects a change reaches, and how
cheaply that is answered a second time. It does not launch a browser, capture or
compare anything. The index it writes is a local cache of one checkout — nothing
here shares it between machines or restores it in CI, and deleting it costs one
cold scan.

The demo writes its index to a temporary directory and removes it on exit. Where
a real run keeps it, what the two on-disk pieces are, and how to force a cold
scan are in [the source index](../../docs/source-index.md).

## The files

- `package.json` — one script, `demo`.
- `scripts/demo.mjs` — runs the demo and prints the block above.
- `src/demo.js` — builds the fixture checkout, scans it three times, and counts
  reused against rebuilt records.
- `src/demo.test.ts` — asserts the three scans agree and that the warm scan
  rebuilds nothing. Run it from the repository root with
  `yarn vitest run examples/selection-reuse/src/demo.test.ts`.
