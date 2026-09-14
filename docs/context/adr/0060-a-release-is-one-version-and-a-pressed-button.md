# ADR-0060 — A release is one version across every package, and a person presses it

**Status:** accepted
**Date:** 2026-09-14
**Extends:** ADR-0024 (a consumer knows one package)
**Discharges:** the first published release spec

## Context

Thirty-three packages, and an adopter installs one or two. ADR-0024 made that the
design: `playwright-test` is the whole surface for a Playwright suite,
`storybook-collector` for a built Storybook, `cli` for everything reached from a
terminal. What those packages import is not the adopter's problem — until a
resolver has to choose versions for it, at which point the internal graph becomes
the first thing they see and the only thing they can act on.

`workspace:^` is what keeps that graph invisible inside the repository and
load-bearing outside it. Yarn rewrites the protocol to a real range at publish
time, so every published manifest carries a range over its siblings and a
consumer's lockfile is one solution to all of them at once. Versioned
independently, those ranges would admit combinations nobody has run: `cli@0.4.2`
resolving `core@0.2.9` is a matrix, and the first question on every bug report
becomes which cell of it the reporter is in.

The second thing a release settles is who can cause one. A published version is
unpublishable, a dist-tag is what every install in the world resolves, and both
are reached in this repository by merging — the cheapest, most delegable, most
automatable act available to a contributor. A release trigger attached to merge
is a release trigger attached to auto-merge, to a rebase that lands at three in
the morning, and to whoever is given write access next.

The third is what the version number promises, which nothing here had said. The
documentation gate is the available evidence and it is not encouraging: 11 of the
20 examples that existed when it first ran had gone stale against renamed APIs.
Publishing makes that churn somebody else's problem, and the version is the only
place to tell them how much of it to expect.

## Decision

**One version, across every package, every time.** `.changeset/config.json` holds
`@variance-authority/*` in a single `fixed` group, so a patch on `png-sharp`
stamps `core`, `cli` and every other manifest with the same number. Versions here
carry no information about which package changed — the changelog does that — and
the number means only *which release this is*. The cost is paid in noise: every
package publishes on every release whether or not a byte of it moved, and
`0.1.0 → 0.1.1 → 0.2.0` names three releases rather than thirty-three
independently evolving libraries. That is the intended reading.

**Versioning happens on merge. Publishing happens when somebody says so.** A
merge touching `.changeset/**` or a manifest opens or updates one *Version
packages* pull request, whose diff — every manifest and every changelog — is the
release for review. Merging it publishes nothing. The registry is reached only by
a person opening `release.yml` and pressing the button, and the publish job is the
only one holding a credential capable of it. The version job could not publish if
it wanted to.

That credential is not a token. The publish job exchanges GitHub's OIDC token for
a short-lived one, which the registry grants only to this repository, this
workflow filename and the `npm` environment, because that is what the trusted
publisher on each package names. Three strings are therefore load-bearing and
cannot be tidied: the file is `release.yml`, the environment is `npm`, and the
repository is where it is. The return is that there is no npm token in this
repository to leak, rotate, or find expired on the one evening a release matters,
and that a tarball built on that path carries provenance — a signed statement of
which commit and which workflow produced it — that a consumer can verify without
trusting us.

**The dist-tag is derived from the version, never typed.** `changeset publish`
takes it from what each manifest carries at the moment the button is pressed. No
release-time input decides what `npm install @variance-authority/cli` resolves,
because a release-time input is a thing to get wrong once, at the only point in
the process that cannot be undone. Every install line in this repository is plain
— `npm install --save-dev @variance-authority/cli`, nothing after it — so the
manifests are the last thing to read before releasing and the only thing that
decides whether those lines resolve.

**`0.x`, and a minor may break anything.** A patch is additive and a minor is
not. The alternative — start at `1.0.0` and mean it — is a promise made against
one corpus, one machine and the rename rate the documentation gate measured, and
`0.x` is the honest reading of that evidence. It is also the cheap one: `^` on a
`0.x` range already refuses to cross a minor, so an adopter who pins nothing
still does not receive a breaking change by resolution.

## Consequences

**A published version constrains a change made here, and the consumer examples
are where that is felt.** The install is the acceptance test and it belongs
outside this repository: each example is its own git repository, depends on
published ranges, resolves them from `registry.npmjs.org`, and commits the
lockfile. Nothing in them reaches back into the workspace — no
`link:`, no `file:`, no path out of `node_modules` — so anything that requires a
clone is a defect in the tarballs rather than in an operator's setup, and it
shows up as a failed run rather than as an opinion.

**A minor is a deliberate bump in those repositories, and that is the gate.**
`^0.1.1` does not accept `0.2.0`, so a minor cannot reach an example by
resolution. Somebody raises the range, installs, and runs; whatever a rename
broke breaks there, before an adopter meets it, in the register an adopter would
meet it in. An example left on the previous minor is not a release that failed —
it is a release whose acceptance test has not been taken yet.

**A second press is a no-op, not a disaster.** `changeset publish` skips versions
the registry already holds and publishes in dependency order, so an interrupted
release is resumed by pressing the button again. The publish job refuses to start
while an unversioned changeset sits on `main`, because that is the state in which
the version it would publish understates what shipped.

**A publish that skipped the build would ship empty tarballs.** `dist` is
gitignored and no package declares `prepack`, so a build before the publish is
the only reason the packages are non-empty. The same absence means a
git-URL dependency on this repository resolves to no built output at all, which
is a property to state rather than a defect to fix: this software is obtained
from a registry.

**`yarn npm publish` is not `npm publish`.** Plain `npm publish` ships
`workspace:^` verbatim and breaks every install. `changeset publish` reads the
package manager from the workspace and uses Yarn, so the rewrite happens wherever
it is run from; what breaks an install is reaching past it for npm's own
command.
