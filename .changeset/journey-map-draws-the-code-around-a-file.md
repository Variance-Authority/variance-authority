---
"@variance-authority/cli": minor
"@variance-authority/help": minor
"@variance-authority/sense": minor
---

`variance ask journey-map` draws the code around a file from the recorded tests that match your words

`variance ask journey-map --file <path> [--query <words>]`, and the `docs_journey_map` tool on the workspace API server, read the latest recording. They run nothing and open no source. A test is kept when its file path or its name contains any of the `--query` words; with no words, every test that ran the file is kept. The answer says how many recorded tests ran the file and how many were kept, and lists the kept tests smallest first. Then it lists each function of the file with the paths the kept tests took through it. Beyond the file, it lists the functions most kept tests ran, nearest first, and then the functions only some of them ran, grouped with the smallest test of each group. A function beyond the file that at least half of all recorded tests ran is counted and not listed. Every suite with a recording answers under its own name. `journeyMaps(root, file, terms)` in `@variance-authority/sense` returns the map for every suite.
