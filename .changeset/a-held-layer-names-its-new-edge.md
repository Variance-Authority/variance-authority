---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

`variance layers --against` names a package that started or stopped importing another package and kept its layer. `layerMoves` returns these packages as `held`. A package that appeared or vanished is now named with its layer and every package it imports, and `layerMoves` returns it as a `LayerPresence` rather than a bare name. So every package edge that a change adds or removes is reported once, whether or not a layer moved.
