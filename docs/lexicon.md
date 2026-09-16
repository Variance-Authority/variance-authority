# Naming a subject you can only describe

Every tool that narrows to one subject takes its id, and a summary prints the
ids. On a suite of fifteen that is enough: an agent reads the list and finds
`page/footer--counts`. On three hundred it is not, and what the reader holds
instead is a description — *the footer with the filter chips*, *the toggle that
marks a todo done*, *the thing that uses the accent token*.

A run already knows every one of those phrasings. It read the component names
off the fiber, the roles and accessible names off the accessibility tree, the
visible text off the DOM, the custom properties off the cascade, the files off
the [source index](source-index.md), the regions off the execution journal. None of it was declared
in order to be found; all of it was derived in order to be compared. Writing it
down per subject turns a description into ids.

That record is the **lexicon**.

## What the run writes down

Per subject, per field: the distinct values the subject carried, code-unit
sorted, capped at 200 distinct values per field with the overflow counted.

| field | from |
|---|---|
| `example` | the census: the components this subject is the narrow example of |
| `names` | the semantic snapshot: accessible name, description, `placeholder`, `alt`, `title` |
| `text` | the snapshot's text band, minus any text the policy digested as volatile |
| `components`, `createdBy` | every attributed boundary |
| `regions` | the execution journal: the lexical names of the regions this subject entered |
| `files` | call-site [provenance](attribution.md) on the nodes, and the source index for each component |
| `roles` | the snapshot |
| `tokens` | the custom properties the boundaries resolved through |

Values are kept exactly as they were read — `TodoFooter`, `Clear completed`,
`--va-space-2` — and never pre-split. A hit prints the value it matched, so the
fact stands under the rank; and splitting is a rule, which applied at write time
would be applied to one side of the match only. The reader owns the rule and
applies it to the query and the value alike.

Digests never enter. A text the policy declared volatile reaches the snapshot as
`v1:…`, and a reader that matched on it would be matching a coordinate rather
than a word.

## Three absences, told apart

A field the run could not read is absent from the report's field list, not
present and empty. No snapshot means no `names`, `text` or `roles`; no journal
means no `regions`; no source index means no `files`. A production build with
the owner links stripped has an empty `createdBy` on every subject — read, and
genuinely empty.

A reader says which of these it is looking at, per field, before it says what
matched, because *nothing matched* and *nothing was read* are answers with
opposite next steps. The cap is reported on the same terms: a subject whose
`text` was cut says how many values it lost, so an empty result is never
mistaken for an exhaustive one.

## Asking a question

`variance_locate {query}` splits the query by the rule the values are split by —
on separators and camel case, folding ASCII case and a trailing plural, keeping
the unsplit compound so `TodoFooter` typed whole still meets `TodoFooter`. A
term matches a value when every part of the term matches a token of the value,
exactly or by a prefix of three or more characters.

```text
7 of 15 subject(s) match `footer chips`.
Read: id, example, names, text, components, createdBy, files, roles, tokens.
Not read: regions (no execution journal was read).

page/footer--counts · 7 boundaries · example of TodoFooter
  footer: id `page/footer--counts`; example `TodoFooter`; components `TodoFooter`; createdBy `TodoFooter`
  chips: components `Chip`
page/todos--empty · 17 boundaries · example of TodoApp
  footer: components `TodoFooter`; createdBy `TodoFooter`
  chips: components `Chip`
…
ds/chip--group · 4 boundaries · example of Stack
  chips: id `ds/chip--group`; components `Chip`

next: variance_composition {subject: "page/footer--counts"} · variance_describe {subject: "page/footer--counts"}
```

The order is orientation, never evidence. A hit ranks by how many of the query's
terms it matched, then by an integer weight per field times an integer rarity of
the word in that field across the subjects, then by fewer boundaries, then by
id. No float reaches the sort, because two machines summing logarithms in
different orders can disagree at the last bit and reorder two hits.

Rarity is counted per field because the fields hold different populations. Every
subject enters `createCard` while the module that declares the cards evaluates,
so as a region that word is worth nothing — and counted once across all fields it
would be worth nothing in the two ids that say `card` either, and the subject
named for the card would lose to a sibling that matched some other word.

A term no subject holds is named as such, beside the accessible names the run did
record, so the next query is asked in the suite's vocabulary rather than the
agent's.

There is no thesaurus and no model, and the reason none is needed is the whole
argument: the run recorded five names for the same thing. `checkbox` finds
`ds/toggle--states` because the run wrote down that the toggle's role is
`checkbox`. `footer` finds the footer story because its id, its example and its
creator all say so.

## What it is measured at

Twenty questions on todomvc, each with the subject a person would open, plus
five the suite holds no subject for:

| | |
|---|---|
| the person's subject is the first hit | 19 of 20 |
| the person's subject is among the first three | 20 of 20 |
| a question with no answer gets no hit | 5 of 5 |

The miss is `clear completed`, where the page whose id holds `completed`
outranks the footer that holds the button; the footer is second. The control is
printed beside it: fifteen ids fit in one summary, and an agent that reads them
scores 20 of 20 by scanning. The tool earns its place on a suite whose ids do
not fit in one answer; on this one the measurement shows only that it agrees
with the reader.

## Where it is kept

The run report carries it, and a report is about one run — its verdicts, its
diffs, its docket. The lexicon is the one section of it that is not: the names a
suite holds change when the suite changes, and the question *which subject do I
mean* is asked far more often than a run happens.

So the lexicon is also written to the **suite index**, the binary artifact a run
leaves behind: the census, the subject denominator, the lexicon, and the commit
they were read at. Equal facts encode to equal bytes there, which is what lets a
cache carry it and a second machine recognise it.

That is what makes a reader possible where no run happened — a fresh checkout, a
pull-request comment, an agent orienting itself in a repository before it has
touched the branch. [Sharing an evaluation](sharing.md) is how the file gets
there: a directory, an action cache, a bucket, or a deployment, on terms where
losing it costs a rebuild and never a wrong answer.

## What it refuses to be

**Not a search engine.** The corpus is a few hundred short names per subject and
the ranking is two integers and a string. No term frequency, because three chips
in one footer is a fact about a list and not a better match. No length
normalisation, because the size of a subject is already a rank key.

**Not evidence.** A wrong top hit costs one more call. The same wrong hit quoted
as a finding would cost a baseline, which is why nothing here carries a verdict,
a pixel count, or a file to open — only ids, and the tools that take them.

**Not a declaration.** Nothing in the lexicon was written by hand or annotated
for discovery. A vocabulary a suite does not already produce is a vocabulary
this cannot answer in, and the honest response to a query in one is to say which
fields were read.
