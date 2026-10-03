---
"@variance-authority/sense": patch
---

Two callbacks on one line stay two regions when a run reads the module twice

When a run loads one module as its source and as its build, the two readings
are joined into one record. A region the two readings share is matched by its
kind, name, path and lines, and two callbacks handed to one call on one line —
`items.find(a) ?? items.find(b)` — match on all of them: both are
`f/find.arg0`. The join kept the first and landed every crossing of the second
on it, so the record held one region where the code has two. The tests that
reached only the second callback were credited to the first, and a review
reported the second as code no case ran, while the function it alone calls
was reached. Regions of one
shape are now matched by their place among each other, the n-th onto the n-th,
in the record a run writes and in the journeys stitched from its stores.
