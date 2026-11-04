# Spec 0109 — a name is answered from where it is asked

**Missing:** place, in the answer to `ask symbol`. Several files of a large
repository export one name, and the answer leads with the door the workspace
imports most. `byDoor` in `packages/help/src/tools/uses-of.ts` orders published
declarations by that count, and `--from` does not reach it: `--from` orders only
file-private declarations, through `nearestFirst` in `declared.ts`, and resolves
installed names. So a file asking for a name gets the most popular one, which in
a repository of wrappers is the primitive its own package wraps. Nothing in the
answer says a candidate is forbidden from there or marked `@deprecated`:
`variance restrictions` says so after the import is written, and no reader in
this repository reads the `@deprecated` tag.
**Built on:** `docs_symbol`, `publishedDeclarations` and `exportsNamed`;
`importsOf`; `Tree.reachedFrom`, read under a `wants` as `search` reads it;
`sharedSegments`; `relationBetween` in `packages/sense/src/restrictions.ts`, which
decides one import against the `.relations.json` files; `ruleFiles` in
`packages/cli/src/commands/relations-file.ts`, which reads them; the `doc` span the
index holds on a `SourceSymbol`; and
[0081](0081-the-tech-stack-is-read-from-the-code.md), whose items 2 and 6 name the
local abstraction of an installed package and whose item 7 sets the budget.
**Held by:** a fixture of packages in `packages/help/src/tools/`, one test per rank
key and per declaration, each failing on today's order; and one measurement over
Kibana through the built command, below.

## Purpose

An agent about to write an import asks what a name is. In a small repository the
name has one definition and any search finds it. In a large one it has many:
about fifty files in Kibana export `useKibana`, most of them a package's typed
wrapper over one generic hook, and a whole-repository `rg` costs seconds there
before it returns them all. A rule that rejects the wrong import speaks after the
import is written. This answer speaks before it.

The answer to *what is this name* depends on where the code that needs it is. A
name from your package wins over a generic one, a package's own wrapper wins
over what it wraps, and an import a `.relations.json` rule forbids from here
comes last. The question needs the source index and no run, so it holds for a
file nothing has run and nothing imports yet: the path alone places it.

## The answer

`variance ask symbol --name <name> --from <path>` answers every declaration it
answers today. The ones a file can import come in place order. Each block keeps
its lines and gains the reason for its place, and an unpublished export gains an
import line, the relative path from the asked file, which it has no other way to
print. Nothing is hidden and no candidate is dropped: the reader sees the choice,
and sees why one came first. The sample leaves out signatures, docs and use counts.

```text
useConfig [function]
import { useConfig } from './config';
declared at libs/alpha/src/config.ts:4
in alpha; wraps kit's useConfig

useConfig [function]
import { useConfig } from 'kit';
declared at libs/kit/src/config.ts:12
reached from alpha; wrapped in alpha
deprecated: use your package's own `useConfig`

useConfig [function]
import { useConfig } from 'beta-kit';
declared at libs/beta-kit/src/config.ts:4
not reached from alpha
restricted from here by libs/.relations.json: beta-kit is for beta
```

With no `--from` there is no place, so the order and the wording stay as they
are, published first as [0104](0104-the-four-code-questions.md) says. The command
takes one `--from`. Where the MCP input gives several paths, a candidate takes the
best rank any of them gives it.

**Candidates** are the published declarations and the unpublished exports of the
exact name, in one list, the files that define it. An export that only passes a
name on, `export { x } from` or `export default imported`, is followed to its
origin as it is today and is one candidate with several doors. A candidate with no
entry has its own file for a door, since a relative import lands there. File-private
declarations, `as` bindings and members cannot be imported, so they are not
candidates: they keep their own blocks after the ranked ones.

A **wrapper** is a candidate that imports the name from another candidate and
exports the name itself, as `export const useKibana = useKibanaGeneric<T>` does.
It is 0081's local abstraction for a name the workspace declares. 0081 item 6 owns
that line for an installed package, and this spec owns it here.

### Rank

The keys apply in this order, each breaking the ties of the one before. They are
compared, never weighted: there is no score to tune and no number to explain.

1. **Allowed.** A candidate restricted from here comes last: the import would fail
   the gate.
2. **Reachable.** The asking package, or a package the imports of its files reach
   directly or through others, comes before a package they do not reach. This is
   the closure 0081 item 3 calls *reached through*, not what a manifest declares.
3. **Not wrapped here.** A candidate wrapped by a candidate in the asking package
   comes after the others.
4. **Near.** The candidate and the files importing it, leaving out the asker,
   tests and other candidates, are counted by how many leading folders each shares
   with the asking file. Counts compare from the deepest ring out, and the first
   that differs decides: the higher count wins.
5. **Door order.** Published before unpublished, as `byDoor` orders them, then
   code-unit order of the path.

The rank is one pure function in `packages/help/src/tools/`, from the
candidates, the asked paths and what was read to the order and its reasons;
`symbol.run` only renders it. Keys 3 and 4 share one `importsOf` read per
candidate. Key 4 is written beside `nearestTo` in `shared-segments.ts` and
replaces `nearestFirst` in `packages/help/src/tools/declared.ts`: a file-private
name has no importers to count, so the key orders those blocks by the same
shared segments, and several paths take the best of them. The tree and the rule
files are read ahead of the call, under `symbol`'s `wants`, and only when a path
is named. With no tree, key 2 is silent and the answer says so. `restsOn` gains
the rule files, so an edit to a rule shows the answer is stale. An edit to an
importer elsewhere reaches keys 2 to 4 when the index next reads it, as it
reaches the use counts of today's answer: tracking every importer and the
closure would stat a neighbourhood on each ask, and a stale order costs a
reading order, never a wrong candidate.

Usage across the repository decides nothing here: on the first row below it
matches the import 5% of the time, and on the last, 62%.

### Declarations

A rule or a tag is reported on the candidate's row, never enforced: the answer
states it, and `variance restrictions` stays the gate. Only a restriction moves a
candidate, because only a restriction fails. A deprecated import still passes, so
its tag is a line and the rank does not read it.

- **A restriction.** For each door of a candidate, `relationBetween` decides the
  import from the asked path to the file the import would land on, which is the
  door and not always the declaring file. It is the decision `restrictedImports`
  takes on one edge. A `restricted` decision names the directory of its rule file
  and the rule's `message`. A candidate is restricted when every door is; otherwise
  the doors that are restricted say so and the rest lead.
- **`@deprecated`.** One reader of doc tags, beside `tags_in` in
  `packages/sense/native/src/declared_role.rs` and reached through `sense` as
  `describedWordsNative` is, returns a tag and its text from the candidate's own
  `doc`. A tag here opens a line outside a fence, so prose that mentions it is not
  one, and its text runs to the next tag or the end of the comment. It is printed
  as written, since the replacement is the author's to name. A tag with no text is
  reported as deprecated with no replacement named. Rust's `#[deprecated]` and
  Java's `@Deprecated` are attributes, not doc tags: they are not read, and the
  answer for such a candidate says so.

A rule file that does not parse is a gap the answer names, with its path; the
ranking stands on what was read. `variance restrictions` keeps refusing it. With no
rule file read at all, the answer says that too, since absent is not allowed.

The reading of rule files moves from `relations-file.ts` to a sibling of
`restrictions.ts` in `sense`, because `help` cannot import `cli` and
`restrictions.ts` performs no I/O. Git stays the one source of which rule files
exist, for the gate, `tools/relations.check.ts` and the answer alike. Parsing
returns its refusal as a value, so the gate refuses and the answer names a gap.
The shape is parsed once and declared tiers are checked after it, by the gate.

## Evidence

Measured on Kibana at commit 2df720904, on an M4 Max with 64 GB, by a throwaway
script, with the truth taken as the import the code writes today, so these numbers
measure agreement with habit and not correctness. A case is one non-test file
importing a name that at least two non-test files define and it does not define
itself, once per file and name. Tests and mocks are not candidates. The usage column
counts the non-test files importing each candidate, a stand-in for `byDoor` and not
today's command.

| Situation | Cases | Usage count | Near | Near and key 2 | Near and key 3 | Keys 2–4 | Hiding through dependencies |
|---|---|---|---|---|---|---|---|
| The import is the top of a wrapper stack | 2,468 | .05 | .90 | .90 | .96 | .96 | .99 |
| The import bypasses a wrapper in its own package | 281 | .77 | .65 | .65 | 0 | 0 | 0 |
| The import bypasses a wrapper in a published dependency | 340 | .99 | .98 | .98 | .98 | .98 | 0 |
| The import bypasses a wrapper in a private dependency | 142 | 1.00 | .93 | .94 | .93 | .94 | 0 |
| No wrapper is involved, a sample of 58,974 | 8,000 | .62 | .96 | .97 | .96 | .97 | .97 |

Each figure is how often the first answer is the import the code wrote. Kibana
holds no `.relations.json`, so key 1 is silent on every row and rests on the
fixture alone. A sixth situation is not in the table: 1,069 cases where the only
wrapper sits in a package the importer does not reach, at .94 for usage, .96 near
and .98 for keys 2–4.

Key 2 pays on the last row: one rounded point on a sample of 58,974 cases. Key 3
pays on the first, six points, and costs the second row. In those 281 cases a
package holds a wrapper and one of its files imports what the wrapper wraps, so
key 3 leads with the wrapper every time. Over the two rows that is 148 more
first answers matching the import and 183 fewer, so key 3 does not raise
agreement with habit. It changes which one comes first on purpose: your name
wins. Only 114 of the 281 sit in a package whose habit is the wrapper, so most
of this code bypasses for a reason or by a habit nothing here can judge. The
import it wrote stays in the answer, after the wrapper.

The last column is why nothing here hides, and why key 3 stops at the asking
package. Hiding what a dependency wraps gains three points on the first row and
loses all 482 imports of the third and fourth, where key 3 keeps them. Even hiding
only within the package would deny 281 imports the code really makes. A hidden
candidate is a wrong answer nobody can see; a demoted one costs a line.

The field agrees on the mechanism and is silent on the benefit. [Tu et
al.](https://ml4code.github.io/publications/tu2014localness) found code local, for
token prediction, and [stack
graphs](https://symposium.eelcovisser.org/details/evcs-papers/11/Stack-graphs-Name-Resolution-at-Scale)
resolve names by shadowing over a module graph, file by file. We found no
measurement of whether an agent told the rule at the moment of choosing makes fewer
wrong imports, and this spec does not make one.

## What this does not do

- **Find a name you do not know.** An exact-name lookup compares only the files
  that export the name. An equivalent under another name stays `ask search`, and
  rules stay the backstop.
- **Rank installed names.** They are read only when the workspace declares none of
  the name, so the rank does not reach them. 0081 item 6 says how `--from` resolves
  them.
- **Answer a layered repository with no packages.** Key 2 has nothing to say there
  and key 4 carries the rank by folders.
- **Discover the neighbourhood.** Key 4 reads folders and importers, not
  communities clustered from the import graph: with each case's import held out,
  a Louvain hierarchy scores .74 on the first row where folders score .90.
- **Say what a change breaks.** A rank is a reading order, never an impact claim.
- **Read lint rules.** `no-restricted-imports` and its like live in a linter's
  configuration, which this does not read. Only `.relations.json` moves a candidate.
- **Check a rule's `maxLayer` or `maxTier`, or a transitive rule.** The first two
  describe a package, not one import, and an import is what is being chosen. A
  transitive rule is decided by `restrictedChains`, walking from shipped seeds over
  every record: the answer to a whole walk, not to one import, so it stays the
  gate's. Where a rule file read holds one, the answer says it was not decided
  here.

## What would discharge this

1. The fixture: two packages over one kit, a wrapper in each, a forbidden
   neighbour, a deprecated primitive, and a file nothing imports yet. A test per
   key and per declaration, failing on today's order.
2. `ask symbol --from` answers by the rank, with its reasons, and `nearestFirst` is
   gone from `packages/help/src/tools/declared.ts`.
3. The restriction and `@deprecated` readings, with the reading of rule files moved
   to `sense`.
4. The table above measured again through the built command on Kibana, by a
   `*.measure.ts` that records the machine, with the first row at .96 and the last
   at .97, and an ask under 1 s warm, 0081 item 7's budget. A figure below them
   means the build differs from the policy that was measured, and that is found
   before this lands. Key 2 goes if it adds nothing for what it costs. Key 3 is not
   judged by agreement, which it does not raise: it is the position that your name
   wins, held by the fixture, and the measurement reports what it costs. Key 1 is
   held by the fixture.
5. The skill's reference, `docs/agent-cli.md` and
   [0106](0106-a-need-names-its-next-move.md) say what `--from` does to `symbol`.
