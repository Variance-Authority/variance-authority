# Native index milestone after recovery

2026-11-18. Apple M4 Pro, 14 CPUs, 48 GiB RAM, macOS 26.7, Node
v24.22.1. AFM revision `c40e3ffb00cdef1b7db876ba429fba061265d789`,
release native addon from `codex/cold-index-milestone`. The checkout held
477,177 indexed source files.
Application caches were fresh for each cold arm; operating-system caches were
not purged. The two arms ran sequentially, Git first, with local test/build
lanes stopped. These are observations from one pair, not a controlled speedup
against the historical 169 s, 52 s or 26 s session observations whose raw
artifacts were lost on restart.

## Complete base index

`updateSourceIndex`, all supported languages, default `dirs: ['.']`. No Help,
search, map, lexicon or test-selection publication was included.

| Route | Inventory | Configuration | Native update | Complete call | Reread | Parsed | Maximum RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Git, cold | 4.647 s | 8.001 s | 33.679 s | 46.331 s | 477,177 | 477,092 | 10,949.8 MiB |
| Filesystem, cold | 3.537 s | 0.675 s | 37.941 s | 42.156 s | 477,177 | 477,092 | 6,294.0 MiB |
| Git, unchanged | 3.305 s | 8.478 s | 1.799 s | 13.585 s | 13 | 0 | 3,749.6 MiB |
| Filesystem, unchanged | 3.222 s | 0.696 s | 38.855 s | 42.777 s | 477,177 | 0 | 6,066.7 MiB |

The Git source-update phase was faster than the filesystem phase. Reading
41,088 indexed configurations through Git cost more than the source phase
saved, so the complete Git call was slower. Unchanged Git source reuse worked;
configuration acquisition still dominated its elapsed time. `packs: false`
proved worktree content again and reused its parses. It did not promise to
skip those reads.

The Git and filesystem cold runs had macOS peak memory footprints of
6,091,380,824 and 5,775,386,664 bytes respectively. Footprint and maximum RSS
are different measurements; the latter includes resident mapped pages.

## Acquisition and parser stages

The native trace measures acquisition/hash and parser-stage spans separately.
The spans overlap, so summing these columns does not give elapsed runtime.
The parser stage also transfers already-settled rows; its duration is not a
count or CPU-time measurement of parser calls. `parsed` above counts actual
parses. Scheduling/settling also includes cached-fact lookup between batches.

| Cold route | Acquisition/hash span sum | Parser-stage span sum | Overlap span sum |
| --- | ---: | ---: | ---: |
| Git | 15.646 s | 17.933 s | 12.323 s |
| Filesystem | 21.967 s | 18.616 s | 14.258 s |

No local Git index repair or Git configuration change was made. The under-10 s
base-index goal was not reached. The next structural targets are configuration
identity/proof before acquiring configuration contents, and source-walk work
outside acquisition/parsing; deferred search work cannot improve this base call.

## Reproduce

Run from this repository after `yarn install && yarn build`. Set `AFM` to the
checkout and `INDEX` to a new path outside that checkout. Use a different fresh
`INDEX` for each cold route, then repeat with the same path for its warm arm.
`git` and `disk` below select blob reads or `packs: false`; both retain Git's
inventory where available.

```bash
VARIANCE_SENSE_TIMINGS=1 node --input-type=module - "$AFM" "$INDEX" git <<'JS'
import { updateSourceIndex } from './packages/sense/dist/published.js';
const [root, index, route] = process.argv.slice(2);
const started = performance.now();
const result = await updateSourceIndex(root, {
  index,
  ...(route === 'disk' ? { packs: false } : {}),
});
console.log(`elapsed ${performance.now() - started} ms; files ${result.files}; reread ${result.reread}; parsed ${result.parsed}`);
if (result.refused !== undefined) throw new Error(result.refused);
JS
```

Raw traces from this run are retained in the task worktree under
`node_modules/.cache/native-milestone/measure-1/` as `git-cold.log`,
`disk-cold.log`, `git-warm.log` and `disk-warm.log`.
