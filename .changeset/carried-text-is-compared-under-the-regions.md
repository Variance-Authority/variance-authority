---
'@variance-authority/sense': patch
---

A Vite 8 build no longer stops with "the map back to the file carries a text for it that is not the file on disk" where a plugin ahead of the probes answered `map: null`, as Storybook's globals step does. The text a map carries is compared with your file on the lines your regions sit on, so a step that changed only other lines builds, and one that changed a region's line stops it as before.

A map column past the end of its line stays on that line, so a line a step made
longer than the file charges no region on the line below when the module loads.
