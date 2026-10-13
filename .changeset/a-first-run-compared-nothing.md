---
'@variance-authority/tribunal': patch
---

The review page no longer reports a comparison it did not make

A render with no baseline was described as one: the viewer said *0 pixels
differ, in regions this run did not record*, the "What moved" card blamed a
baseline carrying no component hashes, and a build of nothing but new renders
was headed *Nothing in this build changed* and said there was nothing to
approve. Each now says the render has no baseline, the docket is headed *No
change to work through*, and the rail says how many renders await review under
Subjects. A render whose count is zero is read by the run's pixel signal: no
pixel differs (outside the ignored regions, for an absorbed render), its pixels
changed uncounted, or it occupies none. The viewer says so in full, and the
rail's *No region named these* rows, reach's *Moved with nothing reaching it*
list and the *Since the last run* rows say so in short, where each used to print
*0 px* or *0 pixels moved*. The docket's line against the previous build counts
a subject that build did not have as new to this run, no longer as one that
moved for the first time.

Smaller corrections on the same page:

- A strip whose build kept no mask, but kept both captures, opens on the
  difference it can draw rather than on the candidate.
- The last approved change in a component's history is dated like every other
  date on the page.
- *3 of theses* reads *3 of these*.
- Links that are controls (the mode pills, *The run*, each build's heading, the
  rail's rows and the change page's renders) are drawn in the page's ink, and
  every other link in its accent, never the browser's blue or visited purple.
- The settled fold is no longer drawn in the build list's bold green.
- A changelog whose approvals no shape grouped no longer opens on a divider
  with nothing above it.
