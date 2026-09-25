# Spec 0070 — a change says what its tests moved

**Missing:** what moved, shown where the edit is. `covering --since <ref>
--against <record>` compares two case indexes region by region and names each
region lost, hidden, thinned or gained, in `text` and `json`. No editor marks a
lost region, and `--format refs` still names the moved regions' cases by full
id.
**Built on:** [0069](0069-the-case-index-layers-each-run.md) (a case index that
holds the whole suite) and [0067](0067-a-case-carries-its-outcome.md) (a region a
stopped case did not reach is a hole, not a loss).

## Purpose

A change to a test moves regions in files the diff does not name. The
comparison exists, and it is read in a terminal. The developer editing the test
does not see it in the file that lost the case, and an agent reading `refs` pays
for every case name again in the motion.

## What would discharge it

**1. A lost region in the editor.** The editors paint a lost region in its own
mark (0063 item 6), in files the edit did not touch, and its popup names the
test file that stopped entering it.

**2. Motion by number.** `--format refs` names each moved region's cases by the
numbers of its case table, as every range already does.

## Acceptance

1. A change whose only edit is a test that stops calling one function marks
   that function **lost** in the editor, and names the test file.
2. The same change with the test failing marks it **hidden**, and names the case.
3. `--format refs --against` names no case by id outside its table.
