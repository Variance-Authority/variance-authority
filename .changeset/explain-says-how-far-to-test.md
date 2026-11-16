---
'@variance-authority/cli': minor
---

`variance select --format explain` prints the selection by import hops, nearest first: each hop count's test files, their recorded seconds, the trail from the changed file to each, and the `--at-distance` command that runs that block; beside a leg, the hops it left are laid out too, marked as left. A selection that runs the whole suite says why, naming the `before` entry a changed file matched, and a changed file nothing reaches is named, with where to declare it: `/// <depends>` or `before`.
