# Spec 0074 — what CI derived is reachable from a checkout

**Missing:** the editors, and the acceptance runs that would show the share
end to end. The share itself is built: one record per mainline and per branch
over `git`, `directory` and `http`, versioned entries each naming its commit,
the publish and replace rules, a miss told from a refusal, and a tribunal
deployment serving the same layout. `variance ask`, `variance serve`,
`variance select`, `variance review` and `yarn test:since` read it. The editors
ask the CLI for what they paint and never cause a fetch, so a laptop that has
not run one of those commands paints *nothing here* while CI's record sits on
`refs/variance/mainline/<name>`.
**Built on:** the share kinds in `packages/cli/src/config-share.ts`, the lines
in `packages/cli/src/share-lines.ts`, the entries in
`packages/cli/src/share-entries.ts`, `packages/core/src/share/`, the tribunal's
`packages/tribunal/src/worker-share.ts`, and the base order in
`packages/cli/src/commands/suite-base.ts`. [ADR-0077](../context/adr/0077-the-config-says-where-an-artifact-lives.md)
places each artifact, and
[ADR-0084](../context/adr/0084-every-base-is-mains-record.md) makes main's
record every reader's base. `docs/sharing.md` is the reference.

## Purpose

A checkout does not need history. Work branches off a mainline and is brought
up to date with it before it merges. So the question a checkout asks is *what
is mainline now*, and how far this checkout is from it. A reader that cannot
get that answer without the user first running a command they did not know
about has the answer only in principle.

## What would discharge it

**1. A reader says what it read, against what.** "Local" below means this
checkout's own layer: in a git worktree, the worktree's own record, never the
primary checkout's. The primary checkout's record is read only as the offline
fallback, when no mainline record was ever fetched on this machine, and the
reader says so.

- **What CI found here, in the editor.** With no local report or record, the
  gutter answers from the branch record, then the mainline record, and says
  which one and how far its commit is from `HEAD`'s merge base. A branch
  record whose commit `HEAD` does not contain is shown as another branch's run
  with its commit, never as this checkout's.
- **A base, in the editor.** The mainline record, never the branch's. The
  gutter names the mainline and the commit it was published at, the way
  `select`'s `record of "<suite>":` line does.
- **The editor asks the CLI to fetch**, the way `variance share --suite
  <name>` does, and keeps what it fetched while the merge base stands, so an
  editor session asking ten questions fetches once and a runner seam is never
  the one that fetches.

## Acceptance

1. On a pull request with baselines under `cache` and a `git` share, CI goes
   red. Then, in a fresh clone of that branch with no `.variance/`,
   `variance ask` names the changed subjects and the head commit the pull
   request pointed at.
2. In a clone with `--depth 1`, a reader answers from the mainline record and
   says the distance is unknown.
3. After a hundred merges, each mainline ref is one commit, and an image
   unchanged across all of them was pushed once.
4. A coverage record published by CI and fetched into a checkout at a different
   absolute path selects the same tests as it does in CI.
5. An editor opened on a fresh clone, before any `variance` command ran there,
   paints the gutter from the mainline record and names it.
