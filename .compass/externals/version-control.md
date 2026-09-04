# Version control

## What it is

The adopter's git repository: the working tree, the index, the commit history,
and the object store that has already named every file's content.

## Good at

Naming content. A file edited and edited back lands on the digest it started
from, so nothing has to be re-derived. It also answers, cheaply and exactly,
which files a change touched.

## Bad at

Saying what a change means. It knows a file moved; it does not know which
component that file declares, or which rendered state that component reaches.

## How it breaks

It answers about the index rather than the working tree, so an unstaged edit
carries a stale digest. A shallow clone has no merge base, so a three-dot diff
has nothing to be relative to. When it cannot answer at all, the run is refused
rather than widened, because a diff that silently came back empty is a green
run over an unobserved surface.

## How you talk to it

Read-only plumbing: `git ls-tree`, `git ls-files`, `git status --porcelain`,
`git hash-object`, and a three-dot diff against a merge base. Nothing in the
system commits, and nothing in it rewrites history.

## Their chart

—
