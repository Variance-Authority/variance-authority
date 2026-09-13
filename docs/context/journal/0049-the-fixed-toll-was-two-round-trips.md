# The fixed toll was two round trips

Every warm row in [`performance.md`](../../performance.md) carried the same 650 ms
whether the diff was four files or none, and the page said so as a caveat: a cost
proportional to the repository rather than to the change. A caveat is not a
finding. The question is which work is proportional to the repository *and* not
needed, and only a profile answers that.

```
node packages/sense/scripts/source-index.mjs {MATERIAL-UI}
node --cpu-prof <a warm scan of the same repository>
```

```
nothing changed   694 ms  = open 113 + scan 387 + publish 195
```

Two answers, both round trips rather than work.

**The publish read the index a second time.** A save writes only the difference
between the committed generation and the one the scan produced, so it needs the
committed generation — and it was fetching it by reading and decoding the whole
chain again, 119 ms of the 195. The generation it wanted was the one the run had
opened a third of a second earlier. What a second read can discover that memory
cannot is a segment another writer published in the meantime, and that is named by
the manifest, which is one small file. So the save re-reads the manifest and
decodes segments only when the chain moved underneath it.

Keeping the opened generation had a second effect that was larger than expected.
A record the scan reused is the record it was handed, so once both sides of the
comparison come from the same decode, structural equality answers on a pointer:
records alone went from 27 ms to 3.

**The walk converted every path twice.** The queue held absolute paths and the
loop converted each back to a repository-relative one to use as a key — `relative`,
then a split of the result to check it against the excluded directory names. But a
resolved edge already *is* a repository-relative path, produced by the same
conversion during resolution, and the seed walk already descends past the excluded
directories rather than filtering them afterwards. The absolute form is wanted
only where a file is opened, which on a run that reuses everything is nowhere.
`node:path` was 84 ms of a 503 ms warm run for 48,738 edges and 24,909 records,
and a queue that stays repository-relative throughout does not spend it.

```
nothing changed   344 ms  = open 112 + scan 216 + publish 15
four files edited 345 ms
```

The scan over the same repository produces byte-identical records before and
after, which is the only claim worth making about a change to a hot path:

```
node -e "<scanRelations over {MATERIAL-UI}, serialized>" | cmp - <the same, before>
```

What is left of the toll is 112 ms decoding the index and about 130 ms walking
24,909 records to check each against its digest, plus 86 ms of git. Those are
proportional to the repository and they are not round trips; reducing them means
deciding a record is unchanged without visiting it, which is a different design
and not this one.

Neither of these was a slow algorithm. Both were a caller asking for something it
was already holding, and neither is visible in a timing — the run was the right
shape and the rows moved with the diff. It took a profile to see that a third of
the floor underneath them was addressed to nobody.
