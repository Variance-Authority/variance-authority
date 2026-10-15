---
'@variance-authority/playwright': patch
---

The capture harness now starts Chromium with the same text settings the renderer paints with (`--font-render-hinting=none`, `--disable-lcd-text`). On Linux, a page laid out with hinting and painted without it wrapped lines differently, so its painted image came out a different height from the layout it was read from.
