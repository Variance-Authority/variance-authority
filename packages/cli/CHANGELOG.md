# @variance-authority/cli

## 0.1.1

### Patch Changes

- Updated dependencies [fe578c8]
  - @variance-authority/sense@0.1.1
  - @variance-authority/core@0.1.1
  - @variance-authority/history@0.1.1
  - @variance-authority/mcp@0.1.1
  - @variance-authority/observe@0.1.1
  - @variance-authority/playwright@0.1.1
  - @variance-authority/png@0.1.1
  - @variance-authority/png-sharp@0.1.1
  - @variance-authority/raster@0.1.1
  - @variance-authority/remote@0.1.1
  - @variance-authority/report@0.1.1
  - @variance-authority/store@0.1.1
  - @variance-authority/storybook@0.1.1

## 0.1.0

### Minor Changes

- 1d402d1: Carry the narrowing coordinate in the report, and print it in the summary header.
  
  A `RunReport` now holds `narrowing`: the ref the run was told to observe from,
  and where the recorded execution index stands — the commit it was written at and
  how many files the working tree differs from it by. A run that narrowed nothing
  carries the second half alone, so the coordinate is present whether or not it was
  spent.
  
  `variance_summary` prints it. Narrowing is an option and stays one; what this
  refuses is the state where an agent works against a suite for weeks without ever
  learning that an index is on disk and that the distance from it is a number. The
  line names the commit and spells out the `variance run --since` that would use
  it, and is omitted when there is no index, no position, or no distance.
  
  `run` takes the coordinate as `index` and acts on it for nothing else.
  `narrowingFor` resolves `since`, `against` and `index` together, so a caller
  assembling a run reaches one call rather than three.

### Patch Changes

- 355e668: Stop labelling a changed region with the path of the node that contains it.
  
  A page this project did not write in React carries no component names, and both
  docket renderers fell back to the containing node's path. A pull-request comment
  led with **`0/1`** in code voice, and a failing Playwright assertion printed
  `1510px — 0` three times, the three rows separated only by their pixel counts.
  Where no component and no landmark phrase exist, both now print the region's
  geometry, which at least finds the rect in the diff image. Collateral counts only
  regions that have a component, so a page with none no longer reports "in 1
  component(s)".
- 9dfa2bd: Run when invoked through the symlink a package manager installs.
  
  `npm install` writes `node_modules/.bin/variance` as a link into the package, so
  `process.argv[1]` is the link while `import.meta.url` is its target. The
  main-module guard compared the two as written, which is true only when the file
  is run by its own path — inside this repository. Installed, `npx variance run`
  evaluated the module, dispatched nothing, and exited `0`: a gate reporting
  success without opening a browser. Both executables now resolve each side
  through `realpath` before comparing, and `tools/bin-symlink.check.ts` runs every
  declared bin twice, by path and through a link, and requires the two to agree.
- Updated dependencies [1d402d1]
- Updated dependencies [9587133]
- Updated dependencies [26ae9ed]
- Updated dependencies [f09528d]
- Updated dependencies [5c3299b]
- Updated dependencies [cfb333d]
- Updated dependencies [e8fee66]
- Updated dependencies [48d32eb]
- Updated dependencies [5c34e6d]
- Updated dependencies [12a5043]
- Updated dependencies [a87d008]
  - @variance-authority/report@0.1.0
  - @variance-authority/mcp@0.1.0
  - @variance-authority/sense@0.1.0
  - @variance-authority/store@0.1.0
  - @variance-authority/core@0.1.0
  - @variance-authority/remote@0.1.0
  - @variance-authority/history@0.1.0
  - @variance-authority/observe@0.1.0
  - @variance-authority/playwright@0.1.0
  - @variance-authority/png@0.1.0
  - @variance-authority/png-sharp@0.1.0
  - @variance-authority/raster@0.1.0
  - @variance-authority/storybook@0.1.0
