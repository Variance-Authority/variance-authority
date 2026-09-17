# Selection reuse

**[Variance Authority](../../README.md)** is a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source — the component that
drew the pixels and the `file:line` it was written at.

Before it renders anything, it has to decide which UI states a code change could
have reached. This example shows that decision being made from the source graph,
and the on-disk index that keeps the second decision from costing what the first
one did.

Two words this page uses:

- A **subject** is one named UI state you asked for and can ask for again — one
  Storybook story, one route at one viewport, one component mounted in a test —
  captured and compared under an id you choose. The demo has two, `story:catalog`
  and `story:account`.
- A **record** is one source file's resolved imports, as the scan stored them.
  The selection answer is computed from records, and a record survives until the
  content of its file changes.

## What it does

The demo builds a throwaway git checkout in your temp directory: 304 files under
`src/`, of which four carry the answer — `tokens.css`, `button.css` (which
imports it), `Button.tsx` (which imports `button.css`) and `Badge.tsx` (which
imports nothing). The other 300 are filler, so the timings below are not the
timings of four files.

It then scans that checkout three times — cold, warm from the index the cold
scan wrote, and again after editing `tokens.css` — asking each time which
subjects a change to `src/tokens.css` reaches. `story:catalog` is collected
because the change reaches `Button`; `story:account` is skipped because it does
not reach `Badge`.

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
differ, and the ratio moves less than the absolute numbers do. A second run here
gave 64.8 ms cold and 28.8 ms warm — the same 2.3×.

Three hundred files is a demo, not a repository. For the same scan at real
scale, [what a source scan costs](../../docs/performance.md) prices it on a
checkout of Material UI — 41,165 tracked paths, 24,909 records — at 2,866 ms
cold against a 357 ms warm run.

The line to read is `304 records reused, 0 rebuilt`: the warm scan rebuilt
nothing and still reached the same two-subject answer as the cold one. After the
token edit it rebuilds only what the edit invalidated and answers the same way
again.

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
