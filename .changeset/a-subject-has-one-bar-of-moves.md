---
'@variance-authority/tribunal': minor
---

A subject page puts every move in one bar under the picture, with a key for each

The moves on a subject used to sit at whatever height their card had in the
right-hand column: *Approve* and *Reject* at the top, *Looks suspicious* one
card down, and the way to the next render back in the rail. A bar under the
picture now holds all of them. It names what is selected: the subject, the
component the analysis named as its cause, its regions, and its place in the
rail (*2 of 5*, or *not in the queue*).

<kbd>J</kbd> and <kbd>K</kbd> walk the rail in the order it is drawn.
<kbd>F</kbd> opens a concern and <kbd>I</kbd> opens one already under
investigation, as the bar's *Flag as investigating* does. Either key starts the
form over in its state. *Approve* and *Reject* stay buttons with no key. No key
fires while a modifier is held, while the focus is anywhere in a form, or as a
held key repeats, and J and K wait while a concern is half written. Caps Lock
does not change what a key does, and on a non-Latin layout the keys are the
ones in the same place. *Keys off*, at the end of the bar, turns every
single-letter key off and is remembered by the browser.

Below 60rem the subject now takes the full width under the rail, rather than a
sliver beside it.
