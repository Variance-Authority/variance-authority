# Where baselines live

Approved images have to sit somewhere between runs, one per **subject** — the
named UI state a baseline belongs to, such as a story or a test — and
there are three places to put them: committed to the repository, tracked
through git-LFS, or stored by a service. They differ in what a clone costs, who
can approve a change, and what happens to the repository as history grows. This
page is the reference for choosing one while you set a project up.

A committed baseline is reviewed as a file in a pull request, so it is named
for what it is an image of: the story or test, and its variant. A change to the
primary button lists `Ui/Button/Primary-chromium.png` and its `.json` record,
and nothing about the machine that painted it. That machine — renderer, browser
engine version, platform, device scale factor and fonts — is written into the
record. An image painted on another machine is still compared, and the field
that differs is named as the cause, so where a baseline is stored has no say in
a verdict. What placement decides is **who has the bytes when the next run
starts**, and what that costs.

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

```bash
npm install --save-dev @variance-authority/cli
```

Baselines outlive a run only under `"retention": "durable"` in the config. The
other mode, `ephemeral`, renders both sides inside a single run and keeps
neither past it, so there is nothing to place. Everything below is about
`durable`.

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

`npx variance doctor` is the readback. It lists each renderer identity the
root's records name, with a count of baselines, and says whether this machine's
identity is one of them — an empty root on a clean checkout is a store nobody committed, and it reads exactly the
same as a store nobody has written to yet.

## What a committed baseline is called

Under `directory` and `lfs`, `baselines.path` names each file. It is a template
under `baselines.root`, the store adds `.png` and `.json`, and when you set none
it is `{title}/{name}-{engine}`. For a Storybook story titled `Ui/Button` and a
Playwright test `checkout › empty cart`, a run writes:

```
baselines/Ui/Button/Primary-chromium.png
baselines/Ui/Button/Primary-chromium.json
baselines/Ui/Button/Primary__dark-chromium.png
baselines/Ui/Button/Primary__dark-chromium.json
baselines/checkout/empty-cart-chromium.png
baselines/checkout/empty-cart-chromium.json
```

The `.json` record is the attribution: which machine painted the image, from
which document, with which fonts missing. It stays text, and reviewable, in
every placement. A labelled image — a second viewport or state of one subject —
appends the label to the name after `__`.

| token | what it is |
|---|---|
| `{title}` | the story's title, or the test's `describe` path, one directory per level |
| `{name}` | the story's name, or the test's own title |
| `{id}` | the whole subject id, as one file name |
| `{file}` | the name of the file that declares the subject, such as `Button.stories.tsx` |
| `{dir}` | the directory of that file, from the repository root |
| `{engine}` | the browser engine's family: `chromium`, `firefox` or `webkit` |
| `{project}` | the Playwright project that ran the test, by its `name` |

A character a file name cannot carry is written `-`, so `checkout › empty cart`
is `checkout/empty-cart`. A `/` inside a title starts a directory, in a
`describe` title as in a story title, so `describe('cart/checkout')` files its
tests under `cart/checkout/`. `{file}` and `{dir}` name files that exist, so
they are checked rather than cleaned.

The path is made of names, so a name that changes moves the baseline. Rename a
story, a test, a `describe` block or a file under `{dir}` or `{file}`, or edit
the template, and the next run finds nothing at the new path: the subject is
`new`, and the run notes the file at the old path as a baseline it did not
plan. Accepting writes the new file; you delete the old one in the same pull
request.

Without `{engine}`, every engine writes the one file. With it, Chromium and
WebKit keep a baseline each. Nothing finer is in the path: two machines that
both paint Chromium write the same file, the record says which one did, and the
last one to accept is the baseline the other compares against. The other machine
still reads unchanged or changed as its pixels say, with the field that differs
named as the cause. When a laptop and CI take turns accepting, each accept
rewrites the record even where no pixel moved; [the records](#the-records-if-the-diffs-are-the-problem)
can live outside version control for that.

Two subjects that render one path stop the run before anything is compared, and
the message names both subjects and the template. The `.json` record names the
subject it was accepted for, so this holds across runs too: a shard, a worker
or a later run that renders an accepted path for another subject stops on it. A
store never numbers its way around it, because a suffix that depends on which
subject was planned first gives your approved image to the other subject when
the order changes. Two paths that differ only in case are the same path,
because a checkout on macOS or Windows writes them as one file.

Two Playwright projects run one test as one subject. When they differ only in a
device scale factor, a colour scheme or a viewport, they paint two images for
one path, and the run stops naming both projects. Put `{project}` into the
fixture's `varianceBaselinePath`, such as `{project}/{title}/{name}-{engine}`,
and each project keeps its own. Only the fixture takes `{project}`: the CLI and
the Vitest plugin have no projects to fill it with, and refuse it.

The record names the project too, and the fixture knows which projects the
config still runs. Rename a project and the first run under the new name takes
over the baseline the old name left, since nothing runs as the old name to
claim it. A path still claimed by a project the config runs stops the run.

### A parallel folder

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

Take the default when the baselines are a corpus rather than part of a
codebase — something you back up, prune, or point a bucket at. Every image is
under one root, in a tree that mirrors your story titles and `describe` blocks,
so a reviewer finds `Ui/Button` in the diff where the sidebar shows it.

### Beside the code

An excerpt — this replaces the `baselines` key of the full
`variance.config.json` above, and the rest of that file is unchanged:

```json
{
  "baselines": { "kind": "lfs", "root": ".", "path": "{dir}/__baselines__/{file}/{name}-{engine}" }
}
```

Take this one when the baselines belong to code in the same repository, which in
a monorepo is every time. With the root at the repository and `{dir}` first, an
image lands next to the file that declares its story or test, so it arrives
with the checkout, moves with the `git mv` that moves the file, is deleted by
the commit that deletes it, and shows up in the diff of the directory that
caused it:

```
src/ui/Button/Button.stories.tsx
src/ui/Button/__baselines__/Button.stories.tsx/Primary-chromium.png
src/ui/Button/__baselines__/Button.stories.tsx/Primary-chromium.json
e2e/checkout.spec.ts
e2e/__baselines__/checkout.spec.ts/empty-cart-chromium.png
e2e/__baselines__/checkout.spec.ts/empty-cart-chromium.json
```

The declaring file comes from the host. Storybook's index names the file of
every story, and the [Playwright fixture](../packages/playwright-test) and the
[Vitest plugin](../packages/vitest-browser) name the test file. A subject no
file declares — a route listed in the config — has no `{dir}`, and a template
that needs one refuses it by name; give that suite a template without `{dir}`
or `{file}`.

The fixture and the plugin open their own stores, so the template is theirs to
take too: `varianceBaselinePath` for the fixture, `baselinePath` for the plugin,
with the same tokens.

`{dir}` is available to `directory` too. Under either backend the images sit
next to code people edit, so they turn up in every diff and every clone; `lfs`
is what keeps the PNG bytes out of the git history.

`createLfsStore` writes its own `.gitattributes` in the root, with a pattern made
from the template, so only files the template can name go through LFS. Under
this template that is `**/__baselines__/*/*-*.png`. The default template's
pattern is `*-*.png`, which at a root of `.` would also take every hyphenated
icon, fixture and screenshot in the repository, so the config refuses that
pair. Give the template a directory of its own, such as `__baselines__`, give
the baselines a root of their own, or set `baselines.pattern` yourself.

`directory` at a root of `.` is refused on the same template for the same
reason: the action commits back what the glob names, and `*-*.png` from the
repository root would stage every hyphenated image in it.

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
characters, no image fetched — and across a network that saving is spent
straight back on one request per subject. So the run declares its working set:
after selection, `npx variance run` names the subjects it is going to look up,
and the store fetches their sidecars for this machine's identity in **one**
request. Subjects a filter ruled out are not named, and a subject with no
baseline comes back as an answer rather than as a miss, so a first run costs one
request too.

The declaration is a hint, not a requirement. A store that does not serve
`/baseline/working-set` answers it with a 404 and the client falls back to one
request per key, which is what a deployment of
[`tribunal`](../packages/tribunal/README.md) does. No **verdict** changes
either way — the verdict is the one word a run reports per subject,
`unchanged`, `changed`, `new` or `ignored`, and it is decided
by the comparison rather than by how many requests fetched the baseline.

Anything else the store cannot answer — an endpoint it cannot call, a refused
token, a 500, a body that is not an answer — **throws**. It is never a miss,
because `new` re-records what is on screen and a network blip read as a miss
destroys the thing the check was against while reporting success.

The serving half is `serveRasterStore` from
[`@variance-authority/remote/store`](../packages/remote/README.md), which binds
loopback; a deployment CI can call is either that behind a proxy you run, or
the [`tribunal`](../packages/tribunal/README.md) Worker, which serves the same
paths on D1 and R2.

## Who accepts a change

A red run needs a person to look. Accepting what they saw writes a new baseline
into the baseline root, the directory `baselines.root` names, or into the
service. So where the baselines live decides who accepts and how. There are three
arrangements, and each puts the approval somewhere else:

| baselines live in | config | a change is accepted by | the record of it is |
|---|---|---|---|
| the CI cache | `directory`, root ignored by git | a label on the pull request, and every push to `main` | the label in the pull request's timeline, and the push |
| git | `directory` or `lfs`, root tracked | a commit on the pull request's branch, reviewed with the code | the commit and the pull-request review |
| a review service | `remote` | an approval or a rejection per subject, on the service's page | the service's decisions |

On GitHub, `Variance-Authority/action` runs any of the three, and the config's
`baselines` section chooses. With the CI cache, the action's `accept` input
accepts, on the run a label started. With git, its `commit-baselines` input
pushes the accepted images to the pull request's branch, which needs a token
whose push starts a workflow. With a review service, a `variance push` step after
the action sends the run there. The
[CLI reference](../packages/cli/README.md#run-it-in-ci) has the step.

### The CI cache

The baseline root is ignored by git on purpose, and the CI job restores it from
the runner's cache before every run. Without the restore, a run starts with an
empty root and reports every subject `new`, as [Committed means
committed](#committed-means-committed) describes.

A reviewer reads the report and adds the `variance: accept` label. That starts a
run that accepts every changed subject, compares again, and saves the baseline
root into the pull request's own cache scope. A subject that is still unstable,
an observation that errored, or a subject that was not observed fails that
second comparison even right after an accept. The check is then red and names
it, and the accept is saved all the same, so one such subject costs no other
subject its baseline. The pull request's later runs read
that scope first, so they compare against what you accepted there even after
`main` moves.

Merging is the second accept. Every push to `main` accepts what `main` renders,
whether the pull request's check was green, red, unfinished, or never run because
the project is new: you judge a change on its pull request, and what you merge is
what `main` draws. The push saves as the label's run does, so a push whose
second comparison fails is red and still records what `main` renders. Every
pull request that holds no accept of its own compares against the newest store
saved on `main`, including one that was already open when that push landed.

Nothing lands in git history, and approval is a label rather than a review of a
diff. A push after an accept does not dismiss a reviewer's approval of the pull
request, and it does not need to: a push that changes a pixel turns the check red again. The
store lasts as long as GitHub keeps the cache entry. GitHub removes an entry
nothing has restored for seven days, and after that every subject reports `new`
until the next push to `main`, or a dispatch with `accept` ticked, records it
again. A pull request from a fork runs with a read-only
token: the label run still accepts, but it cannot take the label off again, and
the pull request gets no comment.

### Git

The root is tracked, as plain files or through git-LFS. Accepting is a commit:
the label starts a run that accepts every changed subject and pushes the images
to the pull request's branch as `github-actions[bot]`. The images are then in
the pull request's diff beside the change that caused them, and the merge takes
them to `main` with the code. Nothing runs on `main` to accept them again.

Merging accepts the images the pull request committed, whatever its check said.
A push to `main` compares what `main` renders against them, and names a
difference as a warning rather than failing on it: `main` has no branch to
commit new images to, so the next pull request's label commits them. It goes
red only where it could not observe a subject.

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
- **git-lfs in the job, for `lfs`.** The Playwright image has none, so install
  it, and after the checkout run `git lfs install --local --skip-smudge`: an
  installed git-lfs does nothing until git is told to run it, and a commit
  without it stores whole images. Leave LFS objects out of the checkout, which
  `actions/checkout` does unless you set `lfs: true`: the run reads a baseline
  image only for a subject whose document changed, and fetches that one image
  with `git lfs pull`. A checkout that fetches them works too, and downloads
  every baseline on every run. Without git-lfs, the run stops with exit 2, an
  error and not a difference, on the first image it needs. The action runs
  `variance doctor --baselines` before the run, which names the first pointer
  git-lfs cannot fetch here and exits 2, so such a job fails on the checkout
  rather than on the first subject whose document changed. The first
  commit-back carries the root's `.gitattributes` with the images.

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
leaves the configured root with baselines and nothing else. The
[Playwright fixture](../packages/playwright-test), its `createVariance` and
`observe` helpers, and the [Vitest plugin](../packages/vitest-browser) point the
stores they open at the same directory. `cacheRoot` in the root
`variance.config.json` moves it with the rest of the cache.
Building a store yourself, `createDurableStore` and `createLfsStore` both take
`cacheRoot`, and both default it to the baseline root — pass a path outside the
work tree. `renderCacheIn(cache)` from `@variance-authority/store/durable`
returns the `renders` directory inside a cache, and `sweepRenderCache` applies
the bound below to it.

### The cache prunes itself

By default that directory is outside the work tree, so `git clean` never
touches it, and it is under a dot-directory nobody browses. Every edit to a document mints a new
key and kills the old one — a run against a changed file never requests the
previous document's image again — so left alone it is a directory that only
grows, in a place you have no reason to look.

Every run sweeps it, and prints what is left:

```
renders: 214.6 MiB cached in <cache>/renders, freed 91.2 MiB
```

The test-runner integrations sweep it by the same rules and print nothing: the
Playwright fixture once in each worker, when its store tears down or a
`createVariance` session closes, whichever comes first, and the Vitest plugin
when the run closes.

An entry survives on two conditions. It must have been requested in the last
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

A run also checks the rest of the cache, at most once a day, by the rules
[the cache](cache.md#what-is-removed-and-when) page lists.

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
  "records": ".variance/records"  // ignored, or restored from the CI cache
}
```

The images stay where `path` puts them, and each record goes to the same path
under `records`. If a change did not update an image,
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

Switching backends, or editing `baselines.path`, is a re-record. Run the suite
once against the new placement on a commit you already trust, rather than
copying files between them. Until you do, every subject reads `new`, and the
files the old template wrote are listed as baselines no planned subject has.
Renaming a story file or a `describe` block is the same move for the subjects in
it, so commit the baseline's rename with the code's.

A root written before `baselines.path` existed is the one exception. A run
still finds a baseline kept under a directory per renderer identity, such as
`v1-6c1f…/primary.png`, whether that directory sat at the root or beside the
declaring file, and compares against it, unchanged or changed as the pixels say, with the move from
the old path to the new one named as the cause. `npx variance accept` writes the
template's path and deletes the old pair, so the pull request shows each one as
a rename. A config that still sets `baselines.layout` is refused with the path
that comes closest: for `"beside"` that is
`{dir}/__baselines__/{file}/{name}-{engine}`, and for `"flat"` the default.

---

**Further:** [what each level of adoption buys](flows.md) ·
[`@variance-authority/store`](../packages/store/README.md) for the two
file-backed stores · [how evidence decides a verdict](reasoning.md).
