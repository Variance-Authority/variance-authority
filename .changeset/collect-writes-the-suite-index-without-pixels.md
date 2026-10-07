---
"@variance-authority/cli": minor
"@variance-authority/report": minor
---

`variance collect` writes the suite index without a visual run: no baseline,
no comparison, no image. Each CI job collects its shard into a part, and
`variance collect merge evidence-*.json --out suite.index` folds them:

```bash
variance collect --shard 1/4 --workers 2 --out evidence-1.json
variance collect merge evidence-*.json --out suite.index
```

Each part records its plan, its build (Storybook digest, commit, and every
source file under `source.dirs` as it is on disk), the config that shaped the
reading, the environment its engine reported, and an outcome for every
subject its shard owns. The merge refuses parts from different builds, plans,
configs or environments, a missing or repeated shard, and sharded and
unsharded parts together, and names the shard to collect again. While any subject failed, it leaves the index at `--out` as it was,
writes `<out>.incomplete`, and exits `2`.

The suite index is version 2: it carries landmarks, the file that declares
each subject, fields the reading did not reach apart from fields it read as
empty, coverage with the reason each subject was not observed in a run
report's words, and the build it came from. Version 1 indexes still open, without those facts.

`variance run --workers` keeps where every worker located a component. Before,
the report's lexicon carried only the last worker's locations, so a component
another worker located fell back to the source scan's candidates.
