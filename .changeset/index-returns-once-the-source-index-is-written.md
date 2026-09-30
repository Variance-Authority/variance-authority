---
"@variance-authority/cli": minor
"@variance-authority/sense": minor
"@variance-authority/help": minor
---

`variance index` returns once the source index is written

Outside CI, `variance index` writes the source index, starts a process of its own for the code map, the journeys, the dependency lexicon and the questions `variance ask` answers from, and returns. Its last line names that process and the log its lines are written to:

```text
follow-ups: the code map, the journeys, the dependency lexicon and the questions are being made by process 48213, and the next variance command waits for it; their lines are written to <cache>/test-selection/<digest>/source-index.bin.follow-ups.log
```

Every later `variance` command waits for that process before it reads anything, and says on stderr that it is waiting. When the process ended before it finished, the next command makes what it left and prints those lines on stderr. In CI, or with `--wait`, `index` makes all four before it returns. `--follow-ups` is what the started process runs, and is refused together with `--wait`.

The source index is a base and one working layer over it that holds the files changed since the base was written. An update reads again only the files whose bytes changed, rewrites the working layer and never the base, and writes nothing when nothing changed. The started process folds the working layer into the base, writing the two as one new base, once the working layer has a tenth as many records as the base, counting added and deleted files. On Kibana (107,163 files), the update after a one-file edit takes 165 ms over an empty working layer and 220 ms over eleven thousand changed files, and the fold takes 620 ms.

`prepareCodeMap` in `@variance-authority/sense` and `refreshDependencyLexicon` in `@variance-authority/help` return a promise. `@variance-authority/sense` exports `readySourceIndex`, which folds the working layer into the base, and `@variance-authority/help` exports `refreshWorkspaceFromIndex` and `publishedGeneration`.
