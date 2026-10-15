---
'@variance-authority/png': patch
---

Rows under a long edit pair with the rows they moved from

The row alignment gave up when the shortest edit between the two pages passed
2,000 runs of rows, and the comparison fell back to position: every row under
the edit sat against whatever used to be at its height. The edit counts every
change on the page, not only the largest, so a section rewritten and lengthened
on a 28,519-row documentation page, with a few lines reflowed further down,
went past it. The comparison reported 2,766,418 pixels, and the crops showed
the before and after panels holding different sections of the page.

Past that bound the two row columns are now split where they agree on a row
that occurs once on each side, as patience diff does, and each stretch between
two such rows is aligned alone. The rows an edit only moved pair with their
shifted partners and the crops show the same content on both sides. A stretch
that shares no such row is compared by position within it, and the pairing is
still kept only when it leaves fewer pixels differing than position does.
