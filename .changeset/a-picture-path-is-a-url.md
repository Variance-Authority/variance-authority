---
'@variance-authority/cli': patch
---

`report --format html` shows every picture when the page names them by path

A run writes each picture under its subject id percent-encoded, so the after
picture of `docs/test-level-coverage` is `docs%2Ftest-level-coverage.after.png`
on disk. The page wrote that name into `src` as it was, and a browser decodes
`%2F` to `/` and asks for `docs/test-level-coverage.after.png`, which does not
exist. Without `--embed-images`, every picture of a subject whose id has a
character the file name encodes did not load. Each segment of the path is now
percent-encoded in `src`, so the browser asks for the file on disk. A page made
with `--embed-images` is unchanged.
