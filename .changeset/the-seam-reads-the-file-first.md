---
'@variance-authority/sense': patch
---

A module your own `enforce: 'pre'` plugin compiles is recorded on the lines you wrote

`withTestSelection` placed its plugin after yours. Vite runs the `enforce: 'pre'`
plugins in the order of the array, so a compiler of yours in that group, such as
`vite-plugin-solid`, rewrote a module before the seam read it, and every region
of that module was recorded on the compiled text's lines. A Solid component came
out a line or more off, and its digest did not match the file on disk. The seam
now goes first, ahead of every plugin in your config.

A `load` hook, or a plugin another wrapper puts ahead of the seam, still hands it
changed text. Your run now stops on the first such module and names the file,
rather than record it on lines you did not write. Let that file load as it is on
disk, or leave it out of `include`. A variant of a file, such as `?raw`, is not
the file and is not refused.
