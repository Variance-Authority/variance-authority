---
'@variance-authority/tribunal': minor
---

The run page draws a family that varies on exactly two axes as a grid: the axis the name format lists first down, the other across, the base in the corner, and a combination nothing in the family is at as an empty cell that names its two values. Placement reads only the records' `step`, stored in a new `build_variations.step` column (migration `0018_variation-step.sql`); a family with a link the name format did not read stays as pairs. A variation picture too large for its tile at quarter size is drawn at a quarter and cropped to its top-left corner, labelled so, rather than shrunk until the sampler chooses its rows.
