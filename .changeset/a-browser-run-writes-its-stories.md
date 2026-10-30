---
'@variance-authority/sense': patch
---

A Vitest run in a page writes its stories again. Vitest loads the configuration a second time for its browser server, and that load found per-case recording already switched off by the first, so it tapped no story.
