---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

`variance layers --against` names a package that started or stopped importing another package and kept its layer. `layerMoves` returns these packages as `held`, so every package edge that a change adds or removes is reported once, whether or not a layer moved.
