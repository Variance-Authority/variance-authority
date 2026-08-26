# Spec 0015 — The first published release

**Missing:** a pushed tag, and a demonstrated install. Nothing has ever been sent
to a registry, so no consumer outside this workspace can resolve
`@variance-authority/*`.
**Built on:** MIT licensing, non-private manifests, changesets holding every
package in one `fixed` group
([`.changeset/config.json`](../../.changeset/config.json)), and
[`.github/workflows/release.yml`](../../.github/workflows/release.yml).

## Purpose

Every adoption path in this repository terminates at the same wall. A collector
is a module that imports one package; a config names that module; the binary
loads it. Outside a clone, none of those resolve, so the honest
time-to-first-verdict on a cold repository is unbounded
([`metrics.md` M6](../metrics.md#m6-time-to-first-verdict-on-a-cold-repository)).
The machinery to end that is written and has never been triggered.

## What would discharge it

**One release, and one install that proves it.** Publishing is the cheap half;
the expensive half is demonstrating that what landed on the registry is usable.

1. Land a changeset with the change it describes. The packages are one product
   and one `fixed` group, so a bump on any of them stamps every manifest in
   lockstep.
2. Merge the version pull request the workflow opens. Its diff — every manifest
   and every changelog — is the record, and merging it publishes nothing.
   Publishing is a separate, hand-run job: no merge can reach a registry, which
   is the only property that survives a repository having contributors.
3. The dist-tag is derived from the version rather than typed at release time,
   and every install line in this repository is plain — `npm install --save-dev
   @variance-authority/cli`, with nothing after it. What the manifests carry when
   the button is pressed is therefore what decides whether those lines resolve,
   and that is the last thing to read before pressing it.

**The install is the acceptance test, and it belongs outside this repository.**
In a directory that is not a clone: add the CLI and one surface package, write a
five-line collector and a config, and reach a verdict. Anything that requires
reaching back into the workspace is a defect in the published tarballs, not in
the operator's setup.

## Known hazards, each already load-bearing

- **`yarn npm publish` is not `npm publish`.** Internal dependencies are declared
  `workspace:^`, which Yarn rewrites to a real range at publish time. Plain `npm
  publish` ships the protocol verbatim and breaks every install. `changeset
  publish` reads the package manager from the workspace and uses Yarn; a publish
  by hand has to remember to.
- **`dist` is gitignored and no package declares `prepack`.** Tarballs are
  non-empty only because the workflow builds before it publishes. A manual
  publish from a clean checkout ships nothing, and a git-URL dependency on this
  repository resolves to no built output at all.

## What it forces a decision about

What the first version number is, and what it promises between minors. The
documentation gate already records that 11 of the 20 examples that existed when
it first ran had gone stale against renamed APIs; a published package makes that
churn somebody else's problem, and the version is the only place to say how much
of it to expect.

## Leaves behind

An ADR on what a release is: lockstep versioning, the merged version commit
rather than a typed command as the trigger, and the dist-tag derived from the
version. None of that is obvious enough to survive as workflow comments alone.
