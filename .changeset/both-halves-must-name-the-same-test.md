---
'@variance-authority/distill': minor
'@variance-authority/eyes': patch
'@variance-authority/cli': minor
---

Both halves must name the same test, and the same root

`variance distill` joins two recordings that were made by different tools, and it
joins them on exact equality. Two independent mismatches made that join fail, and
neither of them said so.

**The test id.** Sense keys a case by its coordinate — `<project-relative file> >
<describe path and name>` — because a name is the coordinate. Eyes takes whatever
id you hand it, and its collision error recommended the runner's own positional
task id, which is the opposite: unique within a run, and moved the moment a case
is inserted above it. Follow both pages and the third reading is unreachable, and
the refusal named only the id you asked for — never the ids it held — so there was
nothing in the output to compare. The refusal now prints the recorded count and up
to five real ids beside it, and states the contract. The collision error asks for
an id stable across runs and unique within one, and names where the journal will
be joined.

**The root.** Eyes records source provenance as absolute paths; sense records
project-relative module files. Compared directly, nothing matched, and *the file
that was addressed* therefore appeared in *the files with no addressed target* —
the distillation opportunity list degenerated to every file the test entered,
confidently and silently.

`distill` takes an optional `root` (`--root` on the CLI, defaulting to the working
directory) and reconciles the two shapes against it. Where it cannot, it withholds
the list rather than printing a wrong one: if no addressed file matches any entered
module under the given root, the two sides are rooted differently, and the output
says so and offers nothing. Suffix matching was considered and rejected — it picks
a winner among plausible matches and hides that it was choosing.

A withheld list is the reading working. An opportunity list built on a root that
does not reconcile is not a weaker answer than none; it is an answer that names
every file you have.
