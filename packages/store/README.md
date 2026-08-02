# @variance-authority/store

**Requires:** a directory this process can write. `store/lfs` additionally
requires `git` on the path, with LFS installed **and smudging on checkout** — see
below for what happens when it is not.

Baselines on disk. Two backends, one requirement.

## What is here, and what is next door

Everything about what a baseline *means* — the contract, the refusal, the checks
a stored record passes before it is believed — is in
[`@variance-authority/raster`](../raster), which requires nothing. That split is
the reason a verdict cannot depend on where the bytes were kept, and it is
tested: [`observe/parity.test.ts`](../observe) runs the same four scenarios
through the durable store, the git-LFS store and a store across a socket, and
pins the expected answer as well as comparing them.

Three stores agreeing on a wrong answer is not a pass.

| entrypoint | requires |
|---|---|
| `.` | a filesystem, and `git` if you use the LFS store |
| `./durable` | a filesystem |
| `./lfs` | a filesystem and `git` |

## The layout is the rule

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

## `null` is earned by exactly one outcome

Both halves of the pair absent. Everything else throws — one file without the
other, a sidecar that will not parse, EACCES after a permissions change, EMFILE
under a run wide enough to exhaust the descriptor table.

The asymmetry forces this. A thrown error costs a re-run. A `null` costs the
baseline: it is read as `new`, `new` records whatever this build painted, and the
image it overwrites was the only evidence of what the subject looked like before
— **all of it reported as success.**

A CI cache restore that ran out of space and a `put` killed between its two
writes both produce exactly a half-written pair.

## git-LFS

```ts
import { createLfsStore } from '@variance-authority/store/lfs';

const store = await createLfsStore({ root: '.variance/baselines' });
store.tracking;   // was `*.png` tracking actually verified with git, or only assumed?
```

Git-LFS is the default in the README's answer to *"where are results stored?"*
because it needs no infrastructure, and because a baseline image is never
hand-merged: you take one side.

The store **refuses a pointer file read as an image**. An un-smudged checkout —
LFS not installed, or `GIT_LFS_SKIP_SMUDGE` set — hands you 130 bytes of text
where a PNG should be, and comparing two of those reports `unchanged` for every
subject in the suite.

The `git` invocation is injected (`CommandRunner`), so all of this is testable
without a git repository.

## Reading

- [ADR-0011](../../docs/context/adr/0011-durable-and-ephemeral-retention.md) — durable vs ephemeral
- [spec 0004](../../docs/specs/0004-artifact-storage.md) — what a store had to answer
