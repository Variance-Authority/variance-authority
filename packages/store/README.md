<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/store

> Variance Authority baselines on a filesystem, in a plain directory or through git-LFS.

Use this package when a comparison needs baselines on a filesystem. Choose the
plain durable backend for a directory owned by one runner, or the LFS backend
when the baseline images must travel with a branch.

Both backends implement the same `RasterStore` contract, and both want a
directory they can write. The LFS one also runs `git`, and expects LFS smudging
on checkout — when that could not be checked, the tracking diagnostic says so
rather than letting an un-smudged clone read as a passing run.

```bash
npm install --save-dev @variance-authority/store
```
## Choose a backend

Everything about what a baseline *means* — the `RasterStore` contract, the
refusal, and the checks a stored record (the JSON sidecar naming the
**document digest**, a hash of the rendered document used to tell whether the
subject could have changed without comparing images) passes before it is
believed — lives in `@variance-authority/raster`, which requires nothing. Each
backend here supplies bytes and metadata to that same contract.

| entrypoint | requires | holds, and when you want it |
|---|---|---|
| `.` | a filesystem, and `git` if you use the LFS store | both backends and the shared layout. Take it when the store is chosen from config at runtime rather than at import. |
| `./durable` | a filesystem | baselines in a plain directory. The single-machine and self-hosted-runner case: nothing to install, and nothing shares them. |
| `./lfs` | a filesystem and `git` | the same layout, with the images tracked by git-LFS so a team gets them on checkout. Take it when baselines must travel with the branch. |
| `./changelog` | `git` and a repository | reading back **why** a baseline is what it is. Take it when you are building a history view rather than running a comparison; nothing in the render path imports it. |

### The `RasterStore` contract

Both backends implement this shape:

| member | signature | answers |
|---|---|---|
| `find` | `(key, identity) => Promise<Found \| null>` | the baseline for `{ subject, label? }`, looked up under any identity that has ever written one; `null` only when none has. `Found` carries the `raster`, whether it is `comparable` (written by the identity asking), and `storedUnder` (the identity that actually wrote it). |
| `describe` | `(key, identity) => Promise<Described \| null>` | the same lookup without the image: `documentDigest`, `comparable`, `storedUnder`, `missingFonts`, and optional `accessibility` and `components`. Cheap enough to run for every subject before deciding which ones need the image at all. |
| `put` | `(key, raster) => Promise<void>` | writes a baseline. |
| `renderCache` | `{ get(documentDigest, identity), put(raster) }` | the **render cache** — images this machine has already painted, keyed by document digest and identity, so an unchanged document is not re-rendered. A lookup or write here never throws; a miss and a failure both just mean "render it". |
| `expect?` | `(keys) => void` | an optional hint naming subjects about to be asked about; both backends here ignore it. |
| `retention` | `'durable' \| 'ephemeral'` | both backends here are `'durable'`. |

## Baseline layout

```
<root>/<identityDigest>/<subject>[__label].png
<root>/<identityDigest>/<subject>[__label].json
```

`identityDigest` is a hash of the render identity — renderer, engine, platform,
device scale factor and fonts — so it names a directory per rendering machine.
`subject` is the id of the thing compared; an optional `label` distinguishes
several images of one subject, such as a viewport or a state.

A baseline written by one machine **cannot be silently picked up by another**:
it is not in the directory the other machine reads.

`find` also scans the sibling identity directories, so a wrong-machine run is
reported as one **sentence** — a single line, ready to print, naming the
platform that *was* found — instead of a mysterious mass failure.

The sidecar carries the identity in readable form, so a baseline can be
attributed to the machine that wrote it and a reviewer can decide whether to
discard it.

`createDurableStore(root, options)` takes two, and `createLfsStore` passes both
through:

| option | default | what it decides |
|---|---|---|
| `layout` | `flat` | `flat` puts every image for the root in one directory per identity, with the subject id percent-encoded into the file name. `beside` reads the subject id as a path and walks it down from the root — `src/ui/Button/<identityDigest>/primary.png` — so baselines sit in the source tree, arrive with the checkout, and move when the component moves. An id with a `..` or an empty segment is refused rather than resolved |
| `cacheRoot` | `root` | where the render cache goes; a durable store doubles as one, so entries are written under `root` unless this points elsewhere |

Both layouts keep the identity directory: a baseline from another machine
still lands in a directory this one does not read. Neither layout enforces
the one rule that matters — a committed root has to actually be committed.

## Missing and corrupt baselines

A missing pair — both `.png` and `.json` absent for a key — returns `null` and
is treated as a new baseline. Any other corruption throws: one file without
the other, a sidecar that will not parse, EACCES after a permissions change,
EMFILE under a run wide enough to exhaust the descriptor table.

A CI cache restore that ran out of space, or a `put` killed between its two
writes, both produce exactly a half-written pair — the case that throws.

## Git LFS backend

```ts
import { createLfsStore } from '@variance-authority/store/lfs';

const store = await createLfsStore({ root: '.variance/baselines' });
store.tracking;   // was `*.png` tracking actually verified with git, or only assumed?
```

Git-LFS is this project's default answer to *where do baselines live*, because it
needs no infrastructure, and because a baseline image is never hand-merged: you
take one side.

The store **refuses a pointer file read as an image**. An un-smudged checkout —
LFS not installed, or `GIT_LFS_SKIP_SMUDGE` set — hands you 130 bytes of text
where a PNG should be, and comparing two of those reports `unchanged` for every
subject in the suite.

`createLfsStore` takes:

| option | default | what it decides |
|---|---|---|
| `root` | required | baseline root, laid out exactly as the durable store lays it out |
| `pattern` | `*.png` | which files are tracked, relative to the `.gitattributes` holding the entry. Only images match by default; the `.json` sidecar next to each is never routed through LFS |
| `attributesFile` | `<root>/.gitattributes` | where the tracking entry lives — the baseline root, not the repository root |
| `cacheRoot` | `root` | where the render cache goes. Defaults to `root`, so cache entries are tracked and committed alongside baselines unless this points outside the work tree |
| `verify` | `true` | `false` skips consulting git entirely, and says so in `tracking.diagnostics` rather than silently |
| `git` | `runCommand` | the `CommandRunner` git is invoked through — a `(command, args, { cwd }) => Promise<{ code, stdout, stderr }>` function, defaulting to a wrapper around `execFile`, swappable in tests |

`git` is injected, so all of this is testable without a git repository.

## Read the baseline changelog

Where baselines are commits, the commit message is where `variance accept` put
the explanation of the update: prose for the reviewer, and versioned
**trailers** — `Key: value` lines appended after the body, for a parser rather
than a person — for a machine. Both are written by
`@variance-authority/report`'s `renderCommitMessage`. This reads them back
into a `ChangelogRecord` — which subjects changed in that commit, and why.

```ts
import { readChangelog, wasRead } from '@variance-authority/store/changelog';

const answer = await readChangelog({ root: '.variance/baselines', limit: 50 });

if (!wasRead(answer)) console.error(answer.because);
else for (const commit of answer.commits) console.log(commit.sha, commit.record.entries);
```

`readChangelog` takes:

| option | default | what it decides |
|---|---|---|
| `root` | required | the baseline root. Only commits that touched a path under it are read — a repository's ordinary commits are not baseline updates, and scanning them would spend the whole log to reach the same answer |
| `cwd` | `root` | where git is run |
| `limit` | `200` | commits to read; a reading that hits this cap notes it in `bounded` rather than presenting the window as the whole history |
| `since` | none | a revision to read forward from, exclusive, passed as `<since>..HEAD`. One that does not resolve is a refusal naming it, never an empty answer |
| `git` | `runCommand` | the `CommandRunner` git is invoked through, so this is testable without a repository |

**An empty list is a real answer only when git ran, this is a repository, and no
commit under the root carried a record.** Every other case is a sentence:
`wasRead` narrows the union, and `because` names what could not be asked. "No
baseline has ever been explained" and "nobody could ask" are opposite findings,
and an operator acting on the first goes looking for a bug in the writer.

A **shallow clone** is the case that would otherwise pass silently — CI checks
out at depth 1, so a reading there sees one commit and would report it as the
whole history. That is not refused, but the answer carries a `bounded` sentence
saying what it could not see, alongside one for any commit whose record this
reader could not decode and one for a limit the log filled.

