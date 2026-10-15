---
'@variance-authority/cli': patch
---

`report --format html --embed-images` writes a page for a run of any size

On a run whose pictures came to hundreds of megabytes, such as 142 tall
full-page screenshots with a before, a diff and an after each, the command
failed with `RangeError: Invalid string length` and wrote nothing. It now
writes the page as it goes, a batch at a time, and holds one picture at once.

A picture two subjects share is carried once. Every card comes before the first picture,
so you can filter, read regions and copy commands while the pictures load.
Each picture arrives in the order the page shows it, holds its place at its
own size before then, and is decoded only near the screen.
