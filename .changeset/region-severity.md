---
'@variance-authority/raster': minor
'@variance-authority/core': minor
'@variance-authority/png': minor
'@variance-authority/observe': minor
'@variance-authority/mcp': patch
---

A changed region is graded by how much its pixels changed in colour: the mask byte is the grade, from 1 for a pixel past the policy's threshold to `SEVERITY_LEVELS.length` for one past 0.2 or a row with no partner, and each `DiffRegion` carries its highest `grade`. The verdict names regions at `STRONG_GRADE` first and counts the rest as faint, so a repaint by a few levels no longer reads like the change beside it. A mask byte is no longer always `1`: test it for non-zero. Regions the 32-region cap leaves out are counted as more regions, not smaller ones, since the faintest go first.
