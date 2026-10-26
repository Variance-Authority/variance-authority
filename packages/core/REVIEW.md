# Reviewing `@variance-authority/core`

The format, rules, comparison, attribution and verdicts, as pure data in and
out, plus the plan identity, the file graph, columnar segments, shared lines
and shard placement. Collectors (`dom`, `react`, `png`) feed it; the CLI,
`report`, `help`, `sense` and the runners call it.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/core/`.

## Contracts

- **No DOM, no I/O, no runtime dependency;** `share` reaches a store only
  through its `cell`. Written in the [README](README.md#what-this-is-for).
- **Every name lives in one entrypoint, and `compare` returns no verdict.**
  The bare specifier exports only the capture artifact; policy is `judge`'s.
  Written in the [README](README.md#entrypoints).
- **An empty band set is `null`, not the quietest band,** and a band the
  profile could not see is `UNOBSERVED`, which no verdict type admits. Written
  in the [README](README.md#the-four-words-the-output-uses) and pinned by
  [`src/compare/diff/diff.test.ts`](src/compare/diff/diff.test.ts) › "names
  geometry as unobserved under jsdom".
- **`flake` is never returned on silence.** Missing provenance or unreadable
  hooks is `unread`. Written in the [README](README.md#which-input-changed)
  and pinned by [`src/compare/parting.test.ts`](src/compare/parting.test.ts) ›
  "will not call a render nondeterministic when the hooks were unreadable".
- **Any part of the plan moves the identity, and two identities never
  compare.** Written in the [README](README.md#what-it-refuses) and pinned by
  [`src/plan/tool.test.ts`](src/plan/tool.test.ts) › "moves when a tool is
  reconfigured without being replaced" and "refuses a duplicated tool, because
  the identity cannot address it".
- **A reach crosses type-only imports unless the caller asks a runtime
  question.** Pinned by [`src/relate/relate.test.ts`](src/relate/relate.test.ts)
  › "crosses a type-only import by default, and leaves it out for a runtime
  question".
- **A segment is validated before it is believed.** Another format, another
  version and a corrupt column are refused; an absent
  optional column is nothing. Pinned by
  [`src/segment/index.test.ts`](src/segment/index.test.ts) › "refuses another
  format, another version, and bytes that are neither".
- **A publish keeps what it must not overwrite.** An entry whose commit
  descends from the run's, and an entry in a newer format, stay; bytes that do
  not match their digest are refused. Written in the
  [README](README.md#hand-an-answer-to-another-machine) and pinned by
  [`src/share/publish.test.ts`](src/share/publish.test.ts) › "keeps a held
  entry whose commit descends from the run: an older run finishing last".
- **A line says why it missed.** `absent`, `newer`, `refused`, `unreachable`
  and `unreadable` stay apart. Pinned by
  [`src/share/line.test.ts`](src/share/line.test.ts) › "answers a newer format
  as newer, not as broken".

## Where to look for a counterexample

- `src/compare/band.ts`: a `style-changed` across two tags landing in `token`.
- `src/compare/parting.ts`: a holding with no hooks read whose output moved.
- `src/relate/`: a caller that passes `RUNTIME_EDGES` where a type change must
  reach, or omits it in selection.
- `src/share/publish.ts`: `descends` answering `undefined`, and a concurrent
  writer that moves the manifest between read and `If-Match`.
