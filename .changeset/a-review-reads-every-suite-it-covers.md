---
'@variance-authority/cli': patch
---

`review --coverage` reads the changed regions from every declared suite

With `--coverage`, the changed regions a review lists are read from every
declared suite, not only the one named with `--suite`. A suite answers for a
changed file it ran as the tree holds it, so a region no unit case entered and
an integration case ran is listed as run, by that case, and no longer as run by
no case while the coverage section beside it counts it. Each region is the
reading of the suite that came nearest, as the handover in a pull request body
already joins them. Where no suite ran the file's current text, the suite named
with `--suite` answers alone. The runs, the base and the freshness the summary
states are still the named suite's.
