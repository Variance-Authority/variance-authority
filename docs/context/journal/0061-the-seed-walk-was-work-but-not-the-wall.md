# The seed walk was work but not the wall

**Date:** 2026-09-18

An unchanged Jira-root scan spent 1.17 seconds walking the seed directory and
then rebuilt 2,472 records whose paths Git could not name. The two observations
had one suspected cause: seed discovery walked the checkout independently of
the Git snapshot that supplied reuse identity.

The experiment made the Git-visible paths below the configured roots the seed.
Non-ignored untracked paths remain present because `git status` contributes them
to the snapshot. Ignored generated paths do not become roots merely because
they exist on disk. A scan with `digests: false` retains the filesystem walk.

The reproduction built a new temporary source index, ran one instrumented
unchanged scan, then repeated unchanged scans against that same index:

```bash
yarn build
TARGET_REPOSITORY=/absolute/path/to/a/clean/frontend-repository
node packages/sense/scripts/source-index.mjs "$TARGET_REPOSITORY" jira
```

The numbers below isolate the benchmark's `openSourceIndex` → `scanRelations` →
`save` sequence. Before and after were run on the same machine and checkout.

```text
                              filesystem seed     Git-visible seed
cold records                         185,825              183,365
records rebuilt unchanged              2,472                   12
warm open                              1.966 s                1.929 s
warm scan                              4.557 s                4.617 s
warm publish                           0.360 s                0.358 s

three further warm scans, Git-visible seed
  scan                                 4.445 s  4.429 s  4.347 s
  total                                7.158 s  6.883 s  6.711 s
```

The removed 2,460 records were generated material: integration-test reports,
downloaded browser resources, generated ambient declarations and tool bundles.
The remaining twelve are reached through imports rather than seeded from the
directory, so changing seed discovery cannot remove them.

The change removes repository-sized work and makes the seed obey the same
identity as reuse, but it does not earn a large wall-time claim. The seed walk
used to run beside the slower Git snapshot, so most of its 1.17 seconds was
hidden by that overlap. The warm scan moved by less than ordinary run-to-run
variation. The useful result is narrower: ignored output stops entering the
graph as a root, and almost every record in an unchanged graph can now be
reused.
