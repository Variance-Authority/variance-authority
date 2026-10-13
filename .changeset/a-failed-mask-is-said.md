---
'@variance-authority/tribunal': patch
---

A difference mask the review page could not compute is reported as failed

When a build keeps no difference mask, the page computes one from the two
captures. If a capture would not load or decode, the viewer said *Working out
the difference…* for as long as the page stayed open. It now says it could not
compute the mask and gives the reason, such as which capture the service
refused. That sentence, and *Working out the difference…* while the mask is
being made, now stand above the image's frame, and the frame draws no region
rings until there is a mask, so the rings no longer cover the words. The frame
keeps its zoom and scroll position while it waits. In a component's strip, a render whose mask failed says so in its
window instead of drawing the region's ring over an empty plate.
