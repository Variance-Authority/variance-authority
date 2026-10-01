---
"@variance-authority/mcp": patch
---

`variance_locate` and `variance_composition` name the run that has no lexicon or composition by what it read, not by its retention

A run writes its lexicon and its composition whenever its collector gives a semantic snapshot, whatever its retention. When a report has neither, `variance_locate` and `variance_composition` said the run was raster-only or ephemeral. They now say the run read no markup: a raster-only capture, or a run whose collector gave only images.
