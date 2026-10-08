---
'@variance-authority/sense': patch
---

A module your own `enforce: 'pre'` plugin compiles is recorded on the lines you wrote

`withTestSelection` placed its plugin after yours. Vite runs the `enforce: 'pre'`
plugins in the order of the array, so a compiler of yours in that group, such as
`vite-plugin-solid`, rewrote a module before the seam read it, and every region
of that module was recorded on the compiled text's lines. A Solid component came
out a line or more off, and its digest did not match the file on disk. The
seam's transform now asks Vite to run first, so it reads each file ahead of every
transform that does not ask the same, wherever its plugin sits: yours, and those
a root config puts ahead of a project's under `extends`.

A `load` hook, or a transform of another plugin that also asks to run first and
sits ahead of the seam, still hands it changed text. Each test file that imports
such a module now fails with an error that names the module, rather than
recording it on lines you did not write. Let that file load as it is on disk, or
leave it out of `include`. A variant of a file, such as `?raw` or any other
query, is not the file and is not refused, and neither is a file whose
`sourceMappingURL` comments Vite blanked after reading its map.
