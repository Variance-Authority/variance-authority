---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance select --format explain` prints the selection by import hops, nearest first: each hop count's test files, their recorded seconds, the trail from the changed file to each, and the `--at-distance` command that runs that block; beside a leg, the hops it left are laid out too, marked as left. A selection that runs the whole suite says why, naming the `before` entry a changed file matched, and counts the suite, saying how many of its test files the record holds no time for. A changed file nothing reaches is named, with where to declare it: `/// <depends>` or `before`. `recordedTimes` now lists the test files it holds no time for as `untimed`.
