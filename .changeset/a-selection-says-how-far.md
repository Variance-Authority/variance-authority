---
'@variance-authority/sense': minor
---

A selection says how far the change travelled, and a loop runs the near end
first.

`distanceByExecution` reads the coverage file once and returns the narrowing
together with, per selected test, the shortest path from the change to it
**through the modules that test entered**. A walk over the import graph alone
returns a shortest path from any change to any file, and it is the wrong one: it
runs through modules the test never loaded, and a distance has to be true of the
graph and of the record at once. `relations` is the graph, `knownAs` gives every
name one module is held under so a built copy and its source are one node,
`faces` says where a unit's public entry point is, and `enumerated` says whether
the graph read a given file's imports at all. `distanceFromView` is the same
reading over a snapshot already open, and `nearestFirst` is the comparison every
consumer sorts by.

Each `TestDistance` carries a `bearing`. `precondition` is the change being the
test's own source — zero hops, and the only zero there is. `direct` and
`transitive` are one hop and more, every hop landing on a module's public entry
point. `reach-through` is a hop that landed inside a unit instead, and names the
importer, what it reached, and the entry it went around. `unexplained` is a test
the change reached along no chain of imports it executed, reported only when the
rest of that run is accounted for. `unmeasured` is the opposite of a finding —
the graph could not answer — and carries `because` saying which; a walk that was
never possible is absent rather than zero (ADR-0002).

`indexFaces` reads the entry-point convention most repositories keep — a
directory with an `index` module — and `eitherFace` stacks a caller's own
provider in front of it, which is where a manifest reader belongs.

`atDistance` takes the selected tests a given number of imports from the change,
`remaining` names what a range left behind, `groupByDistance` reports the whole
reading as one group per hop count, and `distanceRange` reads `2`, `0-2` and
`3-` and refuses anything else rather than quietly running one distance. The
range is hop counts rather than positions in a list, so it asks the same
question whatever the reading turned out to hold: a change whose nearest test is
five hops away answers `0-2` with nothing. Start a near range at `0` — zero is a
test whose own source the edit touched, and a range starting at one leaves it
until last. A test nobody could place runs with the range that reaches the end,
so `0-2` and then `3-` runs every selected file exactly once.
