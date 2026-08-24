<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/store

Use this package when a comparison needs baselines on a filesystem. Choose the
plain durable backend for a directory owned by one runner, or the LFS backend
when the baseline images must travel with a branch.

**Requires:** a writable directory. `store/lfs` additionally uses `git` and
expects Git LFS smudging on checkout; the tracking diagnostic reports when that
assumption could not be checked.

Both backends implement the same `RasterStore` contract.

## Choose a backend

Everything about what a baseline *means* — the contract, the refusal, the checks
a stored record passes before it is believed — is in
[`@variance-authority/raster`](../raster), which requires nothing. That split is
the reason a verdict cannot depend on where the bytes were kept. Each backend
supplies bytes and metadata to the same validation and comparison contract.

| entrypoint | requires | holds, and when you want it |
|---|---|---|
| `.` | a filesystem, and `git` if you use the LFS store | both backends and the shared layout. Take it when the store is chosen from config at runtime rather than at import. |
| `./durable` | a filesystem | baselines in a plain directory. The single-machine and self-hosted-runner case: nothing to install, and nothing shares them. |
| `./lfs` | a filesystem and `git` | the same layout, with the images tracked by git-LFS so a team gets them on checkout. Take it when baselines must travel with the branch. |
| `./changelog` | `git` and a repository | reading back **why** a baseline is what it is. Take it when you are building a history view rather than running a comparison; nothing in the render path imports it. |

## Baseline layout

```
<root>/<identityDigest>/<subject>[__label].png
<root>/<identityDigest>/<subject>[__label].json
```

A baseline written by one machine **cannot be silently picked up by another** —
not by convention, and not by a check somebody remembered to write, but because
it is not in the directory the other machine reads.

`find` then scans the sibling identities so it can say what it *did* find, which
is what turns a wrong-machine run from a mysterious mass failure into one
sentence with a platform in it.

The sidecar carries the identity in readable form. A directory named by a digest
is unreviewable, and a baseline nobody can attribute to a machine is a baseline
nobody can decide to discard.

`createDurableStore(root, options)` takes two, and `createLfsStore` passes both
through:

| option | default | what it decides |
|---|---|---|
| `layout` | `flat` | `flat` puts every image for the root in one directory per identity, with the subject id percent-encoded into the file name. `beside` reads the subject id as a path and walks it down from the root — `src/ui/Button/<identityDigest>/primary.png` — so baselines sit in the source tree, arrive with the checkout, and move when the component moves. An id with a `..` or an empty segment is refused rather than resolved, because it would write outside the root |
| `cacheRoot` | `root` | where the render cache goes, since a durable store is also one. See the LFS table below; the argument is the same and so is the default |

Both layouts keep the identity directory, because that partition is the only
thing between a runner-image upgrade and a day of unattributable red. Which
placement a project wants — and the one rule neither layout can enforce, that a
committed root has to actually be committed — is
[`placement.md`](../../docs/placement.md).

## Missing and corrupt baselines

Both halves of the pair absent. Everything else throws — one file without the
other, a sidecar that will not parse, EACCES after a permissions change, EMFILE
under a run wide enough to exhaust the descriptor table.

The asymmetry forces this. A thrown error costs a re-run. A `null` costs the
baseline: it is read as `new`, `new` records whatever this build painted, and the
image it overwrites was the only evidence of what the subject looked like before
— **all of it reported as success.**

A CI cache restore that ran out of space and a `put` killed between its two
writes both produce exactly a half-written pair.

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
| `pattern` | `*.png` | which files are tracked, relative to the `.gitattributes` holding the entry. Deliberately narrow: the `.json` sidecar beside each image is small, readable, and the only thing that says which machine wrote a baseline, so putting it through LFS makes the reviewable half unreviewable in exchange for nothing |
| `attributesFile` | `<root>/.gitattributes` | where the tracking entry lives. In the baseline root rather than the repository root, because attributes apply to the directory holding the file and everything under it — which is exactly this store's scope. Writing to the repository root takes a shared file hostage to a subdirectory's needs |
| `cacheRoot` | `root` | where the render cache goes. The cache is regenerable and keyed by document digest, so it grows with every edit and is worth nothing after one. Left at the default it is tracked and committed like a baseline — correct, and expensive. Point it outside the work tree to not pay for it |
| `verify` | `true` | `false` skips consulting git entirely, and says so in `tracking.diagnostics` rather than silently |
| `git` | `runCommand` | the `CommandRunner` git is invoked through |

`git` is injected, so all of this is testable without a git repository.

## Read the baseline changelog

Where baselines are commits, the commit message is where `variance accept` put
the explanation of the update — prose for the reviewer, opaque versioned trailers
for a parser (both are
[`@variance-authority/report`](../report)'s `renderCommitMessage`). This is the
other direction:

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
| `limit` | `200` | commits to read. The question this answers is always *recently*, and a reading that filled its cap says so rather than presenting a window as a total |
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

## Reading

- [ADR-0011](../../docs/context/adr/0011-durable-and-ephemeral-retention.md) — durable vs ephemeral
- [ADR-0016](../../docs/context/adr/0016-where-a-baseline-is-kept-decides-nothing.md) — why there are three backends and why the choice must not show
