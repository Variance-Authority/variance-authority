# ADR-0057 — The run writes every name it saw, and a rank is orientation

**Status:** accepted
**Date:** 2026-09-06
**Extends:** ADR-0002 (absent is not empty), ADR-0033 (the component that
mounted it is not the one it sits in), ADR-0055 (a name alone is not a join
across builds), ADR-0056 (a journey is the places visited)
**Relates to:** [spec 0039](../../specs/0039-a-subject-is-found-from-a-description.md)
(what this decision leaves unbuilt), [`composition.md`](../../composition.md)
(the two answers this makes possible), [`agent-mcp.md`](../../agent-mcp.md)
(where an agent asks them)

## Context

A run composes its subjects component-first: which component, in how many
subjects, mounted by whom, sharing which renderings. That is the axis a
finding wants. An agent arriving at a report asks the other way round. It
holds a description — *the footer with the chips*, *the checkbox story*, *the
thing that says Clear completed* — and needs the subject id that every other
tool takes, and then needs to know what that subject is made of. On fifteen
subjects it reads the summary and scans. On three hundred the summary does not
fit in one answer, and the agent spends its calls learning what one call could
have said.

Everything a description could match is already collected. The semantic
snapshot holds roles, accessible names and text; the fiber walk holds every
boundary's component and creator; the source index holds the file each
component is declared in; the journal holds the regions each subject entered.
None of it reaches the report. The graph was cut from the artifact on purpose
— tens of thousands of objects in a file people open — and the snapshots are
gone when the worker closes on the configuration developers use most. The
readers this is for, the pull-request comment and the MCP server, sit on
machines with neither.

Two borrowed vocabularies were on the table: BM25 over the names, and a
semantic layer. On this corpus every term of BM25 degenerates — fifteen
documents of a few tokens each, inverse document frequency over fifteen,
length normalisation over three-token fields — and what survives is *matched
more of the query, in a rarer field*. What BM25 adds is a float in the sort
key, and two machines summing logarithms in different orders can disagree at
the last bit and swap two hits. A semantic layer with no model is a synonym
table, which is a declared tag wearing a search hat.

## Decision

**The run writes every name each subject carried, per field, as a section of
the report. Readers rank over it with integers and print the field under every
hit.**

1. **The lexicon is a section of the report, written by the run.** Per subject,
   per field, the distinct values, code-unit sorted, capped with the overflow
   counted. Nothing is recomputed at query time because nothing survives to
   recompute from. It is absent on a tier that composed nothing; a merged
   report unions it, because per-subject facts union. It carries no run id and
   nothing else that invites a join across builds.

2. **A field the run could not read is absent from the field list, not present
   and empty.** No snapshot means no `names`, `text` or `roles`. No journal
   means no `regions`. A production build with the owner links stripped has an
   empty `createdBy` on every subject. The reader prints the fields it read and
   the fields it did not, with the reason, before it prints what matched. *No
   subject matches* and *no field was read* are two sentences and never one.

3. **A query names things; it does not describe them.** Tokens are derived from
   the values by one rule applied to both sides — split on separators and camel
   case, fold ASCII case and a trailing plural, keep the compound. No synonym
   table, no embedding, no model, no locale. What makes the corpus
   multi-vocabulary is derivation: the run wrote down that the toggle is an
   `input`, role `checkbox`, named *Mark … as done*, declared in
   `components.tsx`, created by `TodoItem`, and a query in any of those
   vocabularies finds it without a thesaurus.

4. **Order is orientation, never evidence.** A hit ranks by terms matched, then
   by an integer weight per field times an integer rarity of the word in that
   field across the subjects, then by fewer boundaries, then by id in code-unit
   order. Rarity is per field because a region every subject entered while a
   module evaluated says nothing about the same word in one subject's id. No float reaches a
   sort. Every hit prints the field and the value it matched on. A wrong first
   hit costs one more call and is never quoted as a finding.

5. **Term frequency does not rank.** A value occurring three times in a subject
   is a fact about a list, not a better match. Document frequency and the
   field's weight remain, and both are integers.

6. **A subject's structure is rows, folded by place.** The report carries, per
   composed subject, its boundaries folded on component, depth, enclosing
   boundary and creator, with a count and the number of distinct props digests
   among them. Not the graph, and not the digests: what a subject is made of
   is the question, and three chips under one stack are one answer to it.

## What it forecloses

- **A float in any sort key.** BM25 as a score, cosine over embeddings, a
  tuned `k1` or `b`. Equal bytes on every machine rules them out before taste
  enters.
- **A synonym table, a stored description, a model in the run.** Declared,
  not derived; rots with the first refactor; and the agent asking is the
  model that would have written them.
- **Recomputing the index from snapshots at read time.** The readers have no
  snapshots.
- **A run id on the lexicon.** A name is not a join across builds
  (ADR-0055), and the section must not offer one.
- **Indexing digests, aliases, tag names, style values, paths.** Coordinates,
  not words; they make every subject match every query.
- **Silent fuzzy matching.** An edit-distance hit is not a fact about anything
  a reader can check.

## Consequences

- `CompositionReport.structure` and `RunReport.lexicon` are written by
  `variance run` on any tier that composed, beside the census.
- `variance_composition {subject}` prints the rows and the renderings the
  subject shares with others, folded by rendering. Three absences get three
  sentences: no structure section, planned and not observed, never planned.
- `variance_locate {query}` ranks subjects over the lexicon and the subject
  ids, prints read and unread fields, the field and value under every hit, and
  the accessible names the run recorded when a term matches nothing.
- The journal is read once more at the end of the run, for every region each
  subject entered rather than only where two subjects parted, and the names
  land in the lexicon's `regions` field.
- The measurement in `examples/todomvc` is the claim, and it prints its own
  control: on fifteen subjects a summary scan scores 20 of 20, and the tool
  scores 19 of 20 first and 20 of 20 within three. The place it earns is a
  suite whose ids do not fit in one answer, and that suite is not yet in the
  repository (spec 0039).
