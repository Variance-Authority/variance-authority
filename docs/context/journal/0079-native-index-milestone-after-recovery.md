# Native index milestone after recovery

2026-11-18. Apple M4 Pro, 14 CPUs, 48 GiB RAM, macOS 26.7, Node
v24.22.1. A private application monorepo,
release native addon from `e2d12776c944fe89f5340e9b7d920efaedfcfdfc`
on `codex/cold-index-milestone`. This measured build precedes the final
parent-component guard, which restores OXC ownership for unresolved paths
containing `..`. The checkout held
about 400k indexed source files.
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
| Git, cold | 4.296 s | 8.308 s | 33.021 s | 45.629 s | ~400k | ~400k | 10,805.4 MiB |
| Filesystem, cold | 3.493 s | 0.613 s | 41.718 s | 45.828 s | ~400k | ~400k | 6,324.5 MiB |
| Git, unchanged | 3.307 s | 8.743 s | 1.647 s | 13.699 s | 13 | 0 | 3,775.3 MiB |
| Filesystem, unchanged | 3.306 s | 0.738 s | 36.365 s | 40.414 s | ~400k | 0 | 6,074.6 MiB |

The Git source-update phase was faster than the filesystem phase. Reading
about 40k indexed configurations through Git cost most of the source phase
saving, leaving the complete cold calls close in this pair. Unchanged Git source reuse worked;
configuration acquisition still dominated its elapsed time. `packs: false`
proved worktree content again and reused its parses. It did not promise to
skip those reads.

The Git and filesystem cold runs had macOS peak memory footprints of
6,149,791,008 and 5,806,991,016 bytes respectively. Footprint and maximum RSS
are different measurements; the latter includes resident mapped pages.

## Acquisition and parser stages

The native trace measures acquisition/hash and parser-stage spans separately.
The spans overlap, so summing these columns does not give elapsed runtime.
The parser stage also transfers already-settled rows; its duration is not a
count or CPU-time measurement of parser calls. `parsed` above counts actual
parses. Scheduling/settling also includes cached-fact lookup between batches.

| Cold route | Acquisition/hash span sum | Parser-stage span sum | Overlap span sum |
| --- | ---: | ---: | ---: |
| Git | 14.883 s | 16.380 s | 11.253 s |
| Filesystem | 24.702 s | 21.336 s | 17.013 s |

No local Git index repair or Git configuration change was made. The under-10 s
base-index goal was not reached. The next structural targets are configuration
identity/proof before acquiring configuration contents, and source-walk work
outside acquisition/parsing; deferred search work cannot improve this base call.

The first recovered pair measured 46.331 s Git / 42.156 s disk cold and
13.585 s / 42.777 s unchanged, with the same file and parse counts. Its raw
traces remain in `measure-1/`. Neither pair reproduces 26 s, and the difference
between the pairs is not a controlled speedup measurement.

## Against the base, on a public corpus

The pair above has no base arm. A matched one: Kibana at `243e962bf`
(115,177 indexed files), `variance index --wait` from the base build and from
this branch, interleaved base, head, base, head, each with a fresh cache for
its cold run and the same cache for its unchanged run. Apple M4 Max, 64 GiB,
load average about 8, operating-system caches not purged.

| Build | Cold, round 1 | Cold, round 2 | Cold system time | Unchanged |
| --- | ---: | ---: | ---: | ---: |
| Base | 13.08 s | 10.17 s | 19.1 s, 16.6 s | 1.64 s, 1.59 s |
| This branch | 7.01 s | 6.43 s | 4.4 s, 4.5 s | 1.76 s, 1.70 s |

Cold is 1.6 to 1.9 times faster, and the saving is system time: the candidate
probes and duplicate reads that no longer reach the file system. User time
moves from 24.8 s to 20.7 s. An unchanged update gains nothing. The two builds
printed the same answer.

## Reproduce

Run from this repository after `yarn install && yarn build`. Set `CHECKOUT` to the
checkout and `INDEX` to a new path outside that checkout. Use a different fresh
`INDEX` for each cold route, then repeat with the same path for its warm arm.
`git` and `disk` below select blob reads or `packs: false`; both retain Git's
inventory where available.

```bash
VARIANCE_SENSE_TIMINGS=1 node --input-type=module - "$CHECKOUT" "$INDEX" git <<'JS'
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
`node_modules/.cache/native-milestone/measure-2/` as `git-cold.log`,
`disk-cold.log`, `git-warm.log` and `disk-warm.log`.

## Power-mode provenance

The power mode used for these measurements and the historical session timings
was not recorded and remains unknown. A later `pmset` reading reported the live
mode as `1`; it does not establish the mode during either measured run.
