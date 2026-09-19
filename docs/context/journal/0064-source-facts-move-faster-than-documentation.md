# Source facts move faster than documentation

**Date:** 2026-09-19

Help refreshed one combined value on every question. That value joined two
facts with different useful lifetimes: the repository graph and symbol usage
move with every edit, while existing signatures, comments and README mentions
usually do not. The source index made the first half incremental, but Help still
rebuilt the second half from it on every request.

The boundary now has two entrances. `readWorkspace` builds the complete reading.
`refreshWorkspace` takes that reading through another Sense scan, replaces
usage, exported names, unreadable files and the graph, and retains the documented
surface. It compares manifest shape and the exported-name set of authoritative
changed paths; adding or removing a symbol rebuilds documentation in the same
turn. A long-lived server performs the volatile refresh per request and the full
reading once per day by default.

The Compass chart places parses and resolved records in Reach's source index.
It does not name the Help projection. This increment treats that projection as
consumer state and leaves the chart unchanged; whether the projection deserves
a chart component is a separate chart-owned decision.

## The scale result

The comparison used the saved source index from the Jira-scale command-line
reading and an authoritative empty changed-file list:

```bash
node /tmp/measure-help-refresh.mjs
```

All three legs returned 300,682 graph records, 1,632 packages, 80,994 published
entries and 660,576 repository exports:

```text
complete documentation     31.041 s
first source refresh       16.449 s
second source refresh      12.853 s
```

The first refresh still paid for pages the preceding complete read brought into
the operating-system cache. The repeated number is the useful steady state: the
source graph and frequency facts are current in less time than rebuilding the
whole documentation view, and a question over the returned in-memory value does
not scan again.

## The native known-change experiment did not move the total

An attempted native Git overlay kept an authoritative changed-file list on the
native graph path during a cold build. The previous JavaScript overlay took
23.590 seconds to scan and 7.653 seconds to publish, 31.243 seconds total. The
native overlay took 29.120 seconds to scan and 2.308 seconds to publish, 31.428
seconds total. It moved work across the boundary without reducing it and was
removed before this increment was kept.
