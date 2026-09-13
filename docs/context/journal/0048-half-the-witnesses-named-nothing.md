# Half the witnesses named nothing

[Journal 0047](./0047-one-added-file-cost-a-whole-repository.md) replaced a
whole-tree key with witnesses: a record is invalidated by the directories its own
specifiers could have been answered from. The row it was aimed at moved from
1,253 ms to 719, and the cost was an index that grew 7.4 MB to 7.9 and a warm run
that grew about 37 ms. Both were written down and neither was explained.

So the same script was made to say who watches whom, rather than only how long a
run took:

```
node packages/sense/scripts/source-index.mjs {MATERIAL-UI}
```

```
what one added path costs: 1492 directories, 1162 of them witnessed,
                           65294 witness entries (2.6 per record)
  records rebuilt      median 5   p90 88   p99 689   max 21500
```

Two things are wrong in that line, and the second one is the bug.

**The median is 5 and the benchmark measured 103.** The row that says "one file
added rebuilds 104 records" adds it to `packages/`, which is watched by 103
records — near the 99th percentile of this repository. The published number was
therefore pessimistic rather than flattering, which is the direction an
unexamined number is usually not. The honest claim is the distribution, so the
script now prints it and [`performance.md`](../../performance.md) carries it.

**The p99 was eight copies of the same directory.** The ten widest directories
included `packages/mui-lab/packages/mui-material/src`,
`docs/packages/mui-material/src`, and six more of that shape — 689 records each,
and no such directory exists. the `mui-lab` package's configuration extends the root
and overrides nothing, so it inherits `paths: { "@mui/*": ["./packages/mui-material/src/*"] }`
— and `aliasesIn` was placing that target against the file that *inherited* it
instead of the file that *wrote* it. TypeScript places `paths` at the
configuration that declared them, or at `baseUrl` where one is set, and each of
those is declared in a file of its own. The fold over an `extends` chain was
keeping the values and discarding which file each came from.

Keeping it is four lines: `compilerOptions` returns the merged values and a map
from option name to the configuration that declared it, and the two placements
read that map instead of the current path.

```
what one added path costs: 1492 directories, 478 of them witnessed,
                           31094 witness entries (1.2 per record)
  records rebuilt      median 7   p90 34   p99 271   max 21500
  the widest directory  packages/mui-icons-material/lib/utils
```

Half the witness entries in the index were for directories that cannot exist.
The index is 7.71 MB rather than 7.90, the p99 blast radius is 271 rather than
689, and the median rose from 5 to 7 because the phantoms were diluting it.

The remaining tail is real and worth naming.
`packages/mui-icons-material/lib/utils` holds the one module that 21,506
generated icons import, so a path appearing there rebuilds 86% of the repository.
That is not over-invalidation: those files do all depend on that directory. A
barrel concentrates dependence and an index can only price what the code says.

The wrong placement was never unsound — a witness naming a directory that does
not exist invalidates nothing, and a superset of the true witness set can only
over-rebuild. That is exactly why it survived: it cost bytes and a tail, not a
wrong answer, and nothing but reading the distribution was going to find it.
