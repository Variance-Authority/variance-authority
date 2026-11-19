---
'@variance-authority/sense': patch
---

A checkout with no source index of its own, such as a fresh worktree, starts from another checkout's index of the same repository and reads only the files that differ from it, rather than reading every file. A record from the other index stands only where nothing in it was parsed, or where the parse store holds the same parse of that blob. The other checkout may have parsed bytes it edited after git named them, so any other record is read again. With no index in any checkout, every file is read as before.
