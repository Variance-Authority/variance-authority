# Changesets

A changeset is one file that says what a change does to the published packages,
written by the person who made it and merged with it. Versions and changelogs
are then derived from those files rather than decided at release time.

```bash
yarn changeset
```

Two things about this repository make the defaults in
[`config.json`](config.json) non-obvious:

- **Lockstep.** The packages are one product and internal dependencies are
  `workspace:^`, so `fixed` holds every `@variance-authority/*` package at a
  single version. Marking one package in a changeset releases all of them; pick
  the bump the *product* deserves, not the one the file you touched does. It also
  makes the dependency bookkeeping changesets writes into every changelog say
  only what the lockstep already guarantees, so `release:version` removes it and
  gives a version with nothing left under it one line saying what it was.
- **Public.** npm defaults a scoped package to restricted, and a restricted
  publish from a workspace without a paid org fails at the registry rather than
  in review. `access: "public"` is what makes `@variance-authority/*` installable
  by anyone, and it is set once here rather than remembered per package.

Private workspaces — everything under `examples/` and `cases/` — are invisible
here: they carry no version and are never published.
