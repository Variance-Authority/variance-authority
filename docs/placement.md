# Where baselines live

A durable run compares the image it just rendered against one an earlier run
wrote. Which of the two wins, and whether they are even allowed to be compared,
is decided by the identity digest and by nothing about the storage
([ADR-0016](context/adr/0016-where-a-baseline-is-kept-decides-nothing.md)). What
placement decides is **who is holding the bytes when the next run starts**, and
what that costs.

Three answers, one config key, and no default — because the three fail in
different directions and none of them is safe to guess.

| `baselines.kind` | the bytes are | you set up | you pay |
|---|---|---|---|
| `directory` | files in a folder you commit | a path | binary blobs in the git history |
| `lfs` | the same files, through the LFS filter | `git lfs install` | LFS storage and bandwidth |
| `remote` | nothing in the repository | a deployment and a token | a network hop, and a run that cannot reach it stops |

## Committed means committed

`directory` and `lfs` both put baselines in your work tree, and both depend on
one thing nothing in this tool can check for you: **the root is tracked, and it
is pushed.** A run that cannot read what the last run wrote does not fail. It
finds no baseline, reports every subject `new`, records what is on screen as the
new truth, and exits 0 — green, forever, comparing nothing.

The trap is a wildcard. `.variance/` is the conventional output directory, it
holds a report and images that genuinely are per-run junk, and a repository that
ignores the whole of it ignores the baselines under it too. If the root lives
there, exclude the contents rather than the directory, so git still descends:

```gitignore
.variance/*
!.variance/baselines/
```

`variance doctor` is the readback. It lists each identity partition in the root
with a count, and says whether this machine's identity is one of them — an empty
root on a clean checkout is a store nobody committed, and it reads exactly the
same as a store nobody has written to yet.

## A parallel folder

```jsonc
// variance.config.json
{
  "project": "todomvc",
  "profile": "chromium",
  "viewport": { "width": 1280, "height": 800 },
  "retention": "durable",
  "subjects": { "kind": "list", "ids": ["home"], "collector": "./collector.mjs" },
  "baselines": { "kind": "directory", "root": "baselines" },
  "report": ".variance/run.json"
}
```

One directory, anywhere, holding every subject in the suite. Under the default
`flat` layout the whole store is one directory per machine identity, and a
subject id is a file name:

```
baselines/v1:6c1f…/src%2Fui%2FButton%2Fprimary.png
baselines/v1:6c1f…/src%2Fui%2FButton%2Fprimary.json
```

The `.json` sidecar is the attribution — which machine wrote the image, and what
it was allowed to be compared against. It stays text, and reviewable, in every
placement. A key carrying a label lands as `<subject>__<label>.png`.

The percent-encoding is what keeps one directory flat, and it is also its cost:
a diff touching four components is four files in one heap, and the heap is
ordered by URL escape rather than by anything a reviewer recognises.

## Beside the code

```json
{
  "baselines": { "kind": "lfs", "root": ".", "layout": "beside" }
}
```

`"layout": "beside"` reads the subject id as a path and walks it down from the
root, so a component's baselines arrive with the checkout, follow the
component when it moves, and show up in the diff of the directory that caused
them:

```
src/ui/Button/v1:6c1f…/primary.png
src/ui/Button/v1:6c1f…/primary.json
```

The identity directory stays, because that partition is the only thing between a
runner-image upgrade and a day of unattributable red. A subject id with no `/`
in it has nothing to walk, and lands in the root as it does under `flat`; an id
with a `..` or an empty segment is refused rather than resolved, because it would
write outside the root.

`beside` is available to `directory` too. It is grouped with LFS because putting
PNGs in the source tree is the case where the filter earns its setup: the files
are next to code people edit, so they are in every diff and every clone.

`createLfsStore` writes its own `.gitattributes` in the root, and the layout
needs nothing added to it — attributes apply to the directory holding the file
and to everything under it.

## Somewhere else entirely

```json
{
  "baselines": { "kind": "remote", "endpoint": "https://variance.internal", "token": "…" }
}
```

Nothing is committed and nothing is cloned, which is the point: no bot commits on
branches, no quota, and a corpus that can outgrow what anyone wants in a work
tree. `variance accept` writes through, so approval stops being a commit.

The bill is round trips. Most subjects settle from the sidecar alone — 32 hex
characters, no image fetched — and across a network that saving is spent straight
back on one request per subject. So the run declares its working set: after selection,
`variance run` names the subjects it is going to ask about, and the store fetches
their sidecars for this machine's identity in **one** request. Subjects a filter
ruled out are not named, and a subject with no baseline comes back as an answer
rather than as a miss, so a first run costs one request too.

Declaring is a hint and never a question. A store that does not serve
`/baseline/working-set` answers the run's declaration with a 404 and the client
falls back to one request per key, which is what a deployment of
[`tribunal`](../packages/tribunal) does. No verdict moves either way.

Anything else the store cannot answer — an unreachable endpoint, a refused token,
a 500, a body that is not an answer — **throws**. It is never a miss, because
`new` re-records what is on screen and a network blip read as a miss destroys the
thing the check was against while reporting success.

The serving half is `serveRasterStore` from
[`@variance-authority/remote`](../packages/remote), which binds loopback; a
deployment that CI can reach is either that behind a proxy you run, or the
[`tribunal`](../packages/tribunal) Worker, which serves the same paths on D1 and
R2.

## What does not belong in the tracked root

A durable store is also a render cache, keyed by the digest of the document that
produced the image. That cache is regenerable, it grows with every edit, and it
lands under the baseline root by default:

```
baselines/v1:6c1f…/by-document/v1:a04e….png
```

Commit that, and you have the whole reason a baseline repository gets its
reputation.
`variance run` therefore points it at `$XDG_CACHE_HOME/variance-authority/renders`
and leaves the configured root holding baselines and nothing else — not a config
field, because there is no answer an operator could give that is better than
"outside the work tree". Building a store yourself, `createDurableStore` and
`createLfsStore` both take `cacheRoot` and both default it to the baseline root.

## Switching

A baseline written under one placement is not portable to another — the paths
differ, and `remote` has no paths at all. What is portable is every verdict: the
four store implementations run the same scenarios in
[`observe/parity.test.ts`](../packages/observe/src/parity.test.ts) with each
expected verdict pinned, because four stores agreeing on a wrong answer is not a
pass.

So switching is a re-record, and the honest way to do it is to run the suite once
against the new placement on a commit you already trust, rather than to copy
files between layouts.

---

**Further:** [`flows.md`](flows.md) for what each level of adoption buys ·
[`@variance-authority/store`](../packages/store) for the two file-backed stores ·
[ADR-0016](context/adr/0016-where-a-baseline-is-kept-decides-nothing.md) for why
none of this reaches a verdict.
