---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

Keep one summary row for each recorded run, beside the record: when it landed,
its suite, its total duration and its case count, for the last four weeks and
at most four hundred rows. `variance view` gains a Cadence tab that draws one
point for each row; a cache with one row draws one point, and a cache with none
draws an empty tab. A figure a run could not tell is left out of its row.
