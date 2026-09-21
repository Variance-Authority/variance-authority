# Orient before you change code

Orientation turns a question about an unfamiliar codebase into an address you
can inspect: a source name, a file, an import neighbourhood, or a captured UI
subject. It comes before diagnosis and editing. Its answer is where to read
next, not a claim that the code is correct.

Variance has two orientation routes:

- **Source orientation** starts from the current checkout. It finds exported
  names and narrows them through resolved module relations.
- **Subject orientation** starts from a completed run. It finds a captured UI
  state from the names, roles, text, components, files and tokens observed on
  that state.

Both routes separate producing an index from asking a question. A producer can
read the repository or run once; an agent, editor or CI step can then ask the
record without repeating that work.

## Why source search exists

Use `rg` when the text itself is the answer. Use `git grep` when the committed
tree is the answer. They are direct, exact and need no Variance index.

The problem changes when an exact word returns hundreds of files. `retry` may
appear in every effect helper, `payment` across a whole commerce domain and
`attempt` in unrelated tests. Another text search changes the words but still
has no fact about which files belong to the code in front of you.

`variance ask search` combines two recorded facts instead:

1. exported names and their documentation find candidates for the words you
   supplied;
2. the module graph keeps the candidates connected to a path you already have.

```bash
variance ask search --query createStore --from src/checkout/ --just-answer
```

`--from` walks the imports of the named path at any depth. `--to` walks the
other direction and finds files that depend on it. The result is a bounded set
of names, not every file containing the same string.

The distinction is measurable. On one warm large-workspace reading,
`rg -l -F createStore .` returned 1,743 files in 17.85 seconds and `git grep`
returned 1,748 committed files in 15.72–16.54 seconds. A recorded
`search createStore --just-answer` returned 33 exported-name groups in
0.84–0.91 seconds; adding `--from` returned the 12 groups in a 101,723-file
import closure in 1.19–1.31 seconds. The full measurement and producer cost are
in [the workspace API guide](agent-workspace-api.md#search-finds-the-name-the-graph-finds-the-area).

Search is not a model and does not invent synonyms. If the repository calls
sign-in `CredentialGate`, ask with likely repository words such as `login`,
`session` and `credential`. The caller supplies vocabulary; the index supplies
deterministic matching and relations.

## Choose the entrance from what you have

| What you have | Ask | What you get |
| --- | --- | --- |
| An exact string in the working tree | `rg -n <text> .` | Current files containing that text |
| An exact string in a committed tree | `git grep -n <text> <tree>` | Committed files containing that text |
| Words for an exported source name | `variance ask search --query <words>` | Matching exported names |
| Words plus a file or directory | Add `--from <path>` or `--to <path>` | Matching names inside the related module area |
| An exact exported name | `variance ask symbol --name <name>` | Its declaration, signature, documentation and consumers |
| A name whose examples you need | `variance ask uses --name <name> --from <path>` | Exact import sites, ordered near the path |
| A description of a captured UI state | `variance ask locate --query <words>` | Subject ids and the observed fields that matched |

[Inspect the workspace public API](agent-workspace-api.md) is the source
orientation how-to and contract. [Find the subject you mean](locate.md) is the
subject orientation how-to. [How search finds a subject](lexicon.md) explains
the observed vocabulary behind that answer.

## Ask the record, or produce a new one

An ordinary source question reuses a published workspace generation for one
hour and refreshes it after that. Use `--just-answer` when an editor, watcher or
CI job owns freshness and question latency must contain no Git status, scan or
regeneration:

```bash
variance ask search --query createStore --from src/checkout/ --just-answer
```

Every answer prints when its workspace generation was produced. If no
generation exists, `--just-answer` refuses instead of turning the question into
an index build. [The source index](source-index.md) explains production,
incremental reuse and CI caching.

Subject orientation reads the report a completed run already produced. Its
[lexicon](lexicon.md) records the words observed per subject and builds its
inverted index when first asked. It does not scan the checkout to answer the
question.

## Know where the answer stops

The source graph records module imports, re-exports, literal dynamic imports,
type imports and asset edges. It is not a function-call graph. `uses` reports
where a name is imported, not where code called it at runtime.

No graph database service is required. The workspace generation stores a
compact graph with dependencies and dependents both materialized. The useful
property is the relation and the bounded traversal; the storage engine is an
implementation choice.

Orientation narrows what to open. Read the named files before changing them,
and use runtime, test or review evidence for claims about behaviour.
