---
'@variance-authority/sense': minor
---

A selection says how far the change travelled, and a loop runs the near end
first.

`distanceByExecution` reads the coverage file once and returns the narrowing
together with, per selected test, the shortest path from the change to it
**through the modules that test entered**. A walk over the import graph alone
returns a shortest path from any change to any file, and it is the wrong one: it
runs through modules the test never loaded. The graph says what could be
imported, the record says what ran, and a distance is the shortest route true in
both. `relations` is the graph, `knownAs` gives every name one module is held
under so a built copy and its source are one node, `faces` says where a unit's
public face is, and `enumerated` says whether the graph read a given file's
imports at all. `distanceFromView` is the same reading over a snapshot already
open, and `nearestFirst` is the comparison every consumer sorts by.

Each `TestDistance` carries a `bearing`. `precondition` is the change being the
test's own source — zero hops, and the only zero there is. `direct` and
`transitive` are one hop and more, every hop landing on a module's public face.
`reach-through` is a hop that landed inside a unit instead, and names the
importer, what it reached, and the entry it went around. `unexplained` is a test
the change reached along no chain of imports it executed, reported only when the
rest of that run is accounted for. `unmeasured` is the opposite of a finding —
the graph could not answer — and carries `because` saying which; a walk that was
never possible is absent rather than zero (ADR-0002).

`indexFaces` reads the face convention most repositories keep, a directory with
an `index` module, and `eitherFace` stacks a caller's own provider in front of
it, which is where a manifest reader belongs.

`bandsOf` cuts that reading into rings, `slice` takes a range of them one-based
and inclusive, `tail` names what a slice left behind, and `bandRange` reads `1`,
`1-3` and `3-` and refuses anything else rather than quietly running one band.
Bands are the hop counts that occur rather than a dense range, and the numbers
are band numbers rather than hop counts, so one loop means the same work in two
checkouts and after either kind of edit. A test nobody could place rides in the
last band, not the first: the first band exists to be the cheapest run that
could disprove the edit.
