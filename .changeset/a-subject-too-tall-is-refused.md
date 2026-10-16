---
'@variance-authority/playwright': minor
---

A subject longer than 16,384 device pixels is refused, not photographed

A subject longer than 16,384 device pixels on either side, Chromium's largest
texture side, is neither captured nor clipped. The run records it as failed,
with its size, and names the fix: bound it with tighter roots, or leave the page
out.
