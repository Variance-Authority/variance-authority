# Changesets

A changeset is one file that says what a change does to the published packages,
written by the person who made it and merged with it. Versions and changelogs
are then derived from those files rather than decided at release time.

[**Variance Authority**](../README.md) — a visual regression system you run
yourself, which renders a UI state, compares it against the baseline you
approved, and reports what changed in the vocabulary of your source — publishes
its `@variance-authority/*` packages from this workspace. This directory holds
the pending changesets and [`config.json`](config.json), the settings the
`changesets` CLI reads.

## When you need one

Write a changeset when your change alters what a published package does: new
behaviour, a fix, a changed signature, anything a person reading a changelog
would want to know. Documentation, tests, repository tooling and the private
workspaces under `examples/` and `cases/` never reach the registry and need
nothing.

No check fails a pull request for missing one. What pays is the changelog: a
release with no changeset behind it reaches npm saying only that the version
moved.

## Writing one

From the repository root, with dependencies installed:

```bash
yarn changeset
```

It asks, in turn:

```
Which packages were affected by the changes you made?
  ◻ changed packages...
  ↑/↓ to navigate • Space: select • Enter: confirm

Which packages should have a major (X.X.X) bump?
Which packages should have a minor (X.X.X) bump?
Please enter a summary for this change (this will be in the changelogs).
```

A selected package left out of both bump questions is a patch. The summary is
free markdown, and the command tells you where the file landed so you can open
it and write the rest properly.

What it writes is one markdown file in this directory — a random name, which you
can rename to anything but `README.md` or `config.json`. It is front matter
naming the packages and their bumps, then the text. This is a real one,
[`an-import-is-not-a-use.md`](an-import-is-not-a-use.md), abridged:

```md
---
'@variance-authority/distill': minor
'@variance-authority/sense': minor
---

An import is not a use

Distill read an entered file and nothing smaller. Any crossing anywhere in a
module made the file entered, at the shortest depth observed, and which region
had been crossed was dropped on the way out.
```

The first line of the body becomes the changelog headline, prefixed with the
hash of the commit the changeset arrived in, and the rest is indented under it.

## What `config.json` sets, and why

**One version for all of them.** Every `@variance-authority/*` package sits in a
single `fixed` group, so all of them move to the same version at every release,
changed or not. Marking one package in a changeset therefore releases all of
them, and the bump to choose — major, minor or patch — is the one the *product*
deserves, not the one the file you touched does. (Internal dependencies are
declared `workspace:^`. That is how the workspace resolves them, not a version
policy; `fixed` is what ties the versions together.)

Because every package moves every time, `changeset version` on its own would
write into every package's changelog that its siblings had moved — an
`Updated dependencies [hash]` block, or a bare `- @variance-authority/png@0.1.1`
bullet where the bump was the entire release. That is only what the `fixed`
group already guarantees. So the release script is two steps:

```json
"release:version": "changeset version && node tools/changelog-tidy.mjs"
```

[`tools/changelog-tidy.mjs`](../tools/changelog-tidy.mjs) removes those
generated lines, and where removing them leaves a version with nothing under it,
writes one sentence saying what the version was. This is
`packages/png-sharp/CHANGELOG.md` in full — three releases, none of them about
that package:

```md
# @variance-authority/png-sharp

## 0.2.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

First release.
```

Text a person wrote in a changeset is never touched; only generated lines are
removed, and only this one sentence is added.

**Published publicly.** Scoped packages default to restricted on npm.
`access: "public"` is what makes `@variance-authority/*` installable by anyone.

Private workspaces — everything under `examples/` and `cases/` — are invisible
here: they carry no version and are never published.

Merging a changeset publishes nothing. What happens next — the version pull
request, and the publish run by hand — is in
[`CONTRIBUTING.md`](../CONTRIBUTING.md).
