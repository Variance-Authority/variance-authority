# Where baselines live

**[Variance Authority](README.md)** is a visual regression system you run yourself: it
renders a UI state, compares it against the baseline you approved, and reports
what changed in the vocabulary of your source — the component that drew the
pixels and the `file:line` it was written at.

This page is the reference for where those approved images are kept between
runs, one per **subject**: one named UI state you asked for and can ask for
again, identified by a stable id such as `story:checkout--empty`. Read it when
you are setting up a project and have to decide whether the images are
committed, tracked through git-LFS, or held by a service. New here? Start with
[your first run](start.md).

```bash
npm install --save-dev @variance-authority/cli
```

Baselines outlive a run only under `"retention": "durable"` in the config. The
other mode, `ephemeral`, renders both sides inside a single run and keeps
neither past it, so there is nothing to place. Everything below is about
`durable`.

Whether two images may be compared at all is decided by the **identity
digest** — a hash of the renderer, browser engine, platform, device scale
factor and fonts that produced the image, written into paths as the
`v1:6c1f…` segment you will see throughout this page. Storage has no say in
it. What placement decides is **who is holding the bytes when the next run
starts**, and what that costs.

There are three answers and no default. Set `baselines.kind` explicitly.

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

`npx variance doctor` is the readback. It lists each identity partition in the root
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

Take this one when the baselines are a corpus rather than part of a codebase —
something you back up, prune, or point a bucket at. When the code is in the
same repository, the placement below is the one that keeps it together.

One directory, anywhere, holding every subject in the suite. Under the `flat`
layout the whole store is one directory per machine identity, and a subject id is
a file name:

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

An excerpt — this replaces the `baselines` key of the full
`variance.config.json` above, and the rest of that file is unchanged:

```json
{
  "baselines": { "kind": "lfs", "root": ".", "layout": "beside" }
}
```

Take this one when the baselines belong to code in the same repository, which in
a monorepo is every time. `"layout": "beside"` puts a subject's image in the
directory holding the thing it is an image of, so it arrives with the checkout,
moves with the `git mv` that moves the component, is deleted by the commit that
deletes it, and shows up in the diff of the directory that caused it:

```
src/ui/Button/Button.tsx
src/ui/Button/v1:6c1f…/primary.png
src/ui/Button/v1:6c1f…/primary.json
```

The identity directory stays in the path. An image painted under a different
renderer, engine, platform, scale factor or font stack lands in its own
partition, so upgrading a runner image does not put the new pixels up against
the old ones.

### How a subject finds its directory

The **collector** is the host-specific code named by the `collector` field in
the config above — the part that discovers which subjects exist and captures
each one from its host, whether that host is Storybook, a route set, or a
fixture runner. Two answers, and you do not choose between them — whichever
one your collector can supply is the one that applies.

A collector that names its own subjects after paths has already said where they
go. `beside` spends the slashes instead of percent-encoding them, so
`components/Button/primary` lands in `components/Button/` under the name
`primary`. An id with a `..` or an empty segment is refused rather than resolved,
because it would write outside the root.

A **story** is not named after a path. Its id is `story:components-button--primary`
— a namespaced identifier, which is what keeps it stable when the file moves and
distinct from a route called the same thing. The directory comes from the built
index instead: Storybook records an `importPath` per story, the plan carries the
directory it names, and the image lands there under the story's whole id.

```
src/ui/shell/HatBar.stories.tsx
src/ui/shell/v1:6c1f…/story%3Ahatbar--accepted-hats.png
```

A story declared at the root of the repository places at the root. A path
climbing out of the project with `../` is refused, and the message names the
subject whose id carried it.

`beside` is available to `directory` too. Under either backend the images sit
next to code people edit, so they turn up in every diff and every clone;
`lfs` is what keeps the PNG bytes out of the git history.

`createLfsStore` writes its own `.gitattributes` in the root, and the layout
needs nothing added to it — attributes apply to the directory holding the file
and to everything under it.

## Somewhere else entirely

An excerpt of the same `baselines` key. `endpoint` is the deployment you run and
`token` the credential it accepts:

```json
{
  "baselines": { "kind": "remote", "endpoint": "https://variance.internal", "token": "…" }
}
```

Nothing is committed and nothing is cloned, which is the point: unlike
`directory` or `lfs`, there is no CI bot pushing updated baseline images back
onto the pull-request branch, and no hosted-storage quota sized for a growing
corpus — this store can outgrow what anyone wants in a work tree. `npx variance
accept` writes through, so approval stops being a commit.

The bill is round trips. Most subjects settle from the sidecar alone — 32 hex
characters, no image fetched — and across a network that saving is spent straight
back on one request per subject. So the run declares its working set: after selection,
`npx variance run` names the subjects it is going to ask about, and the store fetches
their sidecars for this machine's identity in **one** request. Subjects a filter
ruled out are not named, and a subject with no baseline comes back as an answer
rather than as a miss, so a first run costs one request too.

The declaration is a hint, not a requirement. A store that does not serve
`/baseline/working-set` answers it with a 404 and the client falls back to one
request per key, which is what a deployment of
[`tribunal`](../packages/tribunal/README.md) does. No **verdict** moves either
way — the verdict is the one word a run carries per subject, `unchanged`,
`changed`, `new`, `incomparable` or `ignored`, and it is decided by the
comparison rather than by how many requests fetched the baseline.

Anything else the store cannot answer — an unreachable endpoint, a refused token,
a 500, a body that is not an answer — **throws**. It is never a miss, because
`new` re-records what is on screen and a network blip read as a miss destroys the
thing the check was against while reporting success.

The serving half is `serveRasterStore` from
[`@variance-authority/remote`](../packages/remote/README.md), which binds
loopback; a deployment CI can reach is either that behind a proxy you run, or
the [`tribunal`](../packages/tribunal/README.md) Worker, which serves the same
paths on D1 and R2.

## What does not belong in the tracked root

A durable store is also a render cache, keyed by the digest of the document that
produced the image. That cache is regenerable, it grows with every edit, and it
lands under the baseline root by default:

```
baselines/v1:6c1f…/by-document/v1:a04e….png
```

Commit that cache and the repository grows by a render on every edit.
`npx variance run` therefore points it at
`$XDG_CACHE_HOME/variance-authority/renders` and leaves the configured root
holding baselines and nothing else. There is no config field for the location.
Building a store yourself, `createDurableStore` and `createLfsStore` both take
`cacheRoot`, and both default it to the baseline root — pass a path outside the
work tree.

### The cache prunes itself

That directory is outside the work tree, so `git clean` never reaches it, and it
is under a dot-directory nobody browses. Every edit to a document mints a new
key and kills the old one — a run against a changed file never asks for the
previous document's image again — so left alone it is a directory that only
grows, in a place you have no reason to look.

Every run sweeps it, and prints what it holds:

```
renders: 214.6 MiB cached in /home/you/.cache/variance-authority/renders, freed 91.2 MiB
```

An entry survives on two conditions. It must have been asked for in the last
fortnight — a hit refreshes its timestamp, so this is time since something
wanted the image and not time since it was painted — and what is left is cut
oldest-first to 512 MiB across the whole cache. `npx variance doctor` prints the same
size on demand, split by the renderer identity that painted each part, so a
browser you upgraded away from shows up as the entries it left behind.

The sweep runs on every run, not only the runs that fill the cache. A run
against a `remote` store, or one with `"retention": "ephemeral"`, writes nothing
here and refreshes nothing, so once you stop rendering locally the whole cache
ages out over a fortnight and the directory goes with it.

Nothing here touches baselines: the sweep walks the cache root only. Deleting
the whole directory costs you renders and nothing else.

### The records, if the diffs are the problem

An image and its record can be kept in separate places, which is what you reach
for when the records are the thing putting noise in your diffs.

Every baseline is an image and a `.json` record of how it was painted: the
document digest, the identity, the fonts that did not resolve, the regions
something was inspected in. The image changes when a pixel changes. The record
changes whenever the *document* changes — a class name, a build id, a font that
resolved somewhere else — so a record committed beside its image puts a tracked
diff on every edit you make, including the ones that moved nothing.

Point the records somewhere version control is not looking, and that stops. An
excerpt — the `baselines` key again, with the rest of `variance.config.json`
unchanged:

```jsonc
"baselines": {
  "kind": "directory",
  "root": "baselines",
  "layout": "beside",
  "records": ".variance/records"  // ignored, or restored from the CI cache
}
```

The images stay where `layout` puts them. If a change did not update an image,
it now updates no file under version control.

What you are taking on is a second location to keep. Both halves are still
written and both are still read, so a run that finds an image whose record is
gone stops and tells you which file it looked for — it does not quietly decide
the subject is new and record whatever this build painted. Restore the records
with the same mechanism you restore any cache with, or leave the key unset and
let them travel with the images.

## Switching

A baseline written under one placement is not portable to another — the paths
differ, and `remote` has no paths at all. What is portable is the verdict: every
placement answers the same comparison the same way, so moving changes where the
bytes live and nothing about what a run reports.

Switching is therefore a re-record. Run the suite once against the new placement
on a commit you already trust, rather than copying files between layouts.

---

**Further:** [what each level of adoption buys](flows.md) ·
[`@variance-authority/store`](../packages/store/README.md) for the two
file-backed stores · [how evidence reaches a verdict](reasoning.md).
