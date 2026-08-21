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
  the bump the *product* deserves, not the one the file you touched does.
- **Beta.** The repository is in changesets' pre mode under the `beta` tag
  ([`pre.json`](pre.json)), which is what keeps a `minor` changeset from
  publishing as `latest`. Leaving beta is `yarn changeset pre exit`, and it is a
  deliberate act rather than a side effect of a bump.

Private workspaces — everything under `examples/` and `cases/` — are invisible
here: they carry no version and are never published.
