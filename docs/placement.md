# Where baselines live

Approved images have to sit somewhere between runs, one per **subject** — the
named UI state a baseline belongs to, such as `story:checkout--empty` — and
there are three places to put them: committed to the repository, tracked
through git-LFS, or stored by a service. They differ in what a clone costs, who
can approve a change, and what happens to the repository as history grows. This
page is the reference for choosing one while you set a project up.

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
`v1-6c1f…` segment you will see throughout this page. Storage has no say in
it. What placement decides is **who has the bytes when the next run starts**,
and what that costs.

There are three answers and no default. Set `baselines.kind` explicitly.

| `baselines.kind` | the bytes are | you set up | you pay |
|---|---|---|---|
| `directory` | files in a folder you commit | a path | binary blobs in the git history |
| `lfs` | the same files, through the LFS filter | `git lfs install` | LFS storage and bandwidth |
| `remote` | nothing in the repository | a deployment and a token | a network hop, and a run that cannot call it stops |

`directory` has one more arrangement: a root git ignores, which your CI keeps in
its cache between runs. Nothing is committed, so nothing lands in git history,
and the cache decides how long the baselines last. [Who accepts a
change](#who-accepts-a-change) compares all three arrangements by who approves.

## Committed means committed

`directory` and `lfs` both put baselines in your work tree, and both depend on
one thing nothing in this tool can check for you: **the root is tracked, and it
is pushed**, or your CI restores it from its cache before every run. A run that
cannot read what the last run wrote does not stop. It finds no baseline and
reports every subject `new`, which looks the same as a first run. Whoever
accepts it records what is on screen as the new truth, compared with nothing.

The trap is a wildcard. `.variance/` is the conventional output directory, it
contains a report and images that genuinely are per-run junk, and a repository
that ignores the whole of it ignores the baselines under it too. If the root
lives there, exclude the contents rather than the directory, so git still
descends:

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

One directory, anywhere, with every subject in the suite. Under the `flat`
layout the whole store is one directory per machine identity, and a subject id is
a file name:

```
baselines/v1-6c1f…/src%2Fui%2FButton%2Fprimary.png
baselines/v1-6c1f…/src%2Fui%2FButton%2Fprimary.json
```

The `.json` sidecar is the attribution — which machine wrote the image, and what
it was allowed to be compared against. It stays text, and reviewable, in every
placement. A labelled key lands as `<subject>__<label>.png`.

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
directory where the thing it is an image of lives, so it arrives with the
checkout, moves with the `git mv` that moves the component, is deleted by the
commit that deletes it, and shows up in the diff of the directory that caused
it:

```
src/ui/Button/Button.tsx
src/ui/Button/v1-6c1f…/primary.png
src/ui/Button/v1-6c1f…/primary.json
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
index instead: Storybook records an `importPath` per story, the plan picks up
the directory it names, and the image lands there under the story's whole id.

```
src/ui/shell/HatBar.stories.tsx
src/ui/shell/v1-6c1f…/story%3Ahatbar--accepted-hats.png
```

A story declared at the root of the repository places at the root. A path
climbing out of the project with `../` is refused, and the message names the
subject whose id spelled it.

`beside` is available to `directory` too. Under either backend the images sit
next to code people edit, so they turn up in every diff and every clone;
`lfs` is what keeps the PNG bytes out of the git history.

`createLfsStore` writes its own `.gitattributes` in the root, and the layout
needs nothing added to it — attributes apply to the directory the file sits in
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
[`tribunal`](../packages/tribunal/README.md) does. No **verdict** changes
either way — the verdict is the one word a run reports per subject,
`unchanged`, `changed`, `new`, `incomparable` or `ignored`, and it is decided
by the comparison rather than by how many requests fetched the baseline.

Anything else the store cannot answer — an endpoint it cannot call, a refused
token, a 500, a body that is not an answer — **throws**. It is never a miss,
because `new` re-records what is on screen and a network blip read as a miss
destroys the thing the check was against while reporting success.

The serving half is `serveRasterStore` from
[`@variance-authority/remote`](../packages/remote/README.md), which binds
loopback; a deployment CI can call is either that behind a proxy you run, or
the [`tribunal`](../packages/tribunal/README.md) Worker, which serves the same
paths on D1 and R2.

## Who accepts a change

A red run asks a person to look. Accepting what they saw writes a new baseline
into the baseline root, the directory `baselines.root` names, or into the
service. So where the baselines live decides who accepts and how. There are three
arrangements, and each puts the approval somewhere else:

| baselines live in | config | a change is accepted by | the record of it is |
|---|---|---|---|
| the CI cache | `directory`, root ignored by git | a label on the pull request | the label in the pull request's timeline |
| git | `directory` or `lfs`, root tracked | a commit on the pull request's branch, reviewed with the code | the commit and the pull-request review |
| a review service | `remote` | an approval or a rejection per subject, on the service's page | the service's decisions |

The [workflow recipe](../.github/workflows/variance.yml) runs any of the three,
and one value chooses: `VARIANCE_REVIEW`, set to `cache`, `git` or `tribunal`.
The config's `baselines` section has to agree with it. The
[workflows README](../.github/workflows/README.md#who-accepts-a-change) lists
what each value needs.

### The CI cache

The baseline root is ignored by git on purpose, and the CI job restores it from
the runner's cache before every run. Without the restore, a run starts with an
empty root and reports every subject `new`, as [Committed means
committed](#committed-means-committed) describes.

A reviewer reads the report and adds the `variance: accept` label. That starts a
run that accepts every changed subject, compares again, and saves the baseline
root into the pull request's own cache scope. When the pull request merges, the
run on `main` renders the merge and accepts what it rendered, if the pull request's check was green at its
head and `main` was green before the merge. When either was red, `main` stays
red until somebody dispatches the workflow with `accept` ticked.

Nothing lands in git history, and approval is a label rather than a review of a
diff. A push after an accept does not dismiss a reviewer's approval of the pull
request, and it does not need to: a push that changes a pixel turns the check red again. The
store lasts as long as GitHub keeps the cache entry. GitHub removes an entry
nothing has restored for seven days, and after that every subject reports `new`
until somebody accepts again. A pull request from a fork runs with a read-only
token: the label run still accepts, but it cannot take the label off again, and
the pull request gets no comment.

### Git

The root is tracked, as plain files or through git-LFS. Accepting is a commit:
the label starts a run that accepts every changed subject and pushes the images
to the pull request's branch as `github-actions[bot]`. The images are then in
the pull request's diff beside the change that caused them, and the merge takes
them to `main` with the code. Nothing runs on `main` to accept them again.

The approval is the pull-request review you already require. Whether the bot's
push dismisses an earlier approval is a branch rule, set in GitHub rather than
here: turn on *Dismiss stale pull request approvals when new commits are
pushed*, and name the baseline root in `CODEOWNERS` when one team approves
images.

Three things this needs from the repository:

- **A token whose push starts a workflow.** A push made with `GITHUB_TOKEN`
  starts none, so the commit with the accepted images gets no check, and a rule
  that requires the check blocks the merge. Save a GitHub App token or a
  fine-grained token with `contents: write` as the `VARIANCE_PUSH_TOKEN` secret.
- **A branch in this repository.** A pull request from a fork runs with no
  secrets and a read-only token, so its label run cannot push. Its baselines are
  committed by hand.
- **git-lfs in the job, for `lfs`.** The Playwright image has none. Install it
  and fetch LFS objects in the checkout, or the store stops on a pointer file
  where it expected an image.

### A review service

`remote`, pointed at a [Tribunal](../packages/tribunal/README.md) deployment: a
review service you host, with a database of builds and decisions and a review
page. Every run's report and images are sent there with `npx variance push`, and a person approves or
rejects each subject on the service's review page. Approving makes that build's
image the baseline in the service, so the next run compares against it. Nothing
in git or in the CI cache changes, and the label accepts nothing.

The service keeps the decisions: who approved which subject and when, each
rejection, and every subject's history across builds. The check does not run
again on its own after a decision. Re-run it, and the pull request goes green
once every change in it is approved. A pull request from a fork runs with no
secrets, so it has no ingest token and its runs are not sent.

## What does not belong in the tracked root

A durable store is also a render cache, keyed by the digest of the document that
produced the image. That cache is regenerable, it grows with every edit, and it
lands under the baseline root by default:

```
baselines/v1-6c1f…/by-document/v1-a04e….png
```

Commit that cache and the repository grows by a render on every edit, so `npx
variance run` points it at `<cache>/renders` in [your cache](cache.md) and
leaves the configured root with baselines and nothing else. `cacheRoot` in the
root `variance.config.json` moves it with the rest of the cache.
Building a store yourself, `createDurableStore` and `createLfsStore` both take
`cacheRoot`, and both default it to the baseline root — pass a path outside the
work tree.

### The cache prunes itself

By default that directory is outside the work tree, so `git clean` never
touches it, and it is under a dot-directory nobody browses. Every edit to a document mints a new
key and kills the old one — a run against a changed file never asks for the
previous document's image again — so left alone it is a directory that only
grows, in a place you have no reason to look.

Every run sweeps it, and prints what is left:

```
renders: 214.6 MiB cached in <cache>/renders, freed 91.2 MiB
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

An image and its record can be kept in separate places, which is what you use
when the records are the thing putting noise in your diffs.

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

Switching is a re-record. Run the suite once against the new placement on a
commit you already trust, rather than copying files between layouts.

---

**Further:** [what each level of adoption buys](flows.md) ·
[`@variance-authority/store`](../packages/store/README.md) for the two
file-backed stores · [how evidence decides a verdict](reasoning.md).
