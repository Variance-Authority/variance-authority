---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A checkout with no source index it can stand on — none yet, as in a fresh worktree, a damaged one, or one another release wrote — starts from another checkout's index of the same repository and reads only the files that differ from it, rather than reading every file. `variance index` names the index it started from, and the update's result carries it as `from`. A record from the other index stands only where nothing in it was parsed, or where the parse store holds the same parse of that blob. The other checkout may have parsed bytes it edited after git named them, so any other record is read again. With no index in any checkout, every file is read as before.
