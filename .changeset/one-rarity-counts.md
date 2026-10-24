---
'@variance-authority/mcp': patch
---

`@variance-authority/mcp/tools` exports `rarity(population, holders)`, the integer from 0 to 1000 that `locate`, `orient` and the place line already ranked words by, so another word search ranks by the same count. `heldWeight(held, rarityOf, fieldOf)` sums each held word's rarity times the weight of the field it is held in, the weight `locate` ranks subjects by.
