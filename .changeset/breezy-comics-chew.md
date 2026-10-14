---
'@variance-authority/cli': minor
---

Merge recorded test shards without a journey comparison

Use `variance journeys merge <record.bin>... --into <record> [--root <checkout>]` to combine rich test recordings while preserving coverage and case sections for `distill`. The command writes the landed record and counts without requiring a visual project configuration or computing a journey comparison. `--root` names the source checkout and defaults to the working directory.
