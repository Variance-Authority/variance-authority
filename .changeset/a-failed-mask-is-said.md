---
'@variance-authority/tribunal': patch
---

A difference mask the review page could not compute is reported as failed

When a build keeps no difference mask, the page computes one from the two
captures. If a capture would not load or decode, the viewer said *Working out
the difference…* for as long as the page stayed open. It now says it could not
compute the mask and gives the reason, such as which capture the service
refused. In a component's strip, a render whose mask failed says so in its
window instead of drawing the region's ring over an empty plate.
