# Every name a run saw

A run reads a subject under many vocabularies at once. It takes the component
names off the fiber, the roles and accessible names off the accessibility tree,
the visible text off the DOM, the custom properties off the cascade, the files
off the [source index](source-index.md), the regions off the
[execution journal](journeys.md). **The synonyms are not inferred, they were
observed** — by separate instruments that were pointed at the same subject for
other reasons, and that were finished with the readings long before anybody
asked a question.

Writing those readings down per subject is what turns a description into ids.
That record is the **lexicon**, and [`variance_locate`](locate.md) is what reads
it.

## Why no thesaurus and no model

The usual way to find a thing you can only describe is to make the machine
understand the description: stem it, expand it through a thesaurus, embed it and
compare vectors. Each of those bridges the same gap — the corpus holds one name
for the thing, and the reader used a different one.

Here the corpus does not hold one name. It holds the component name *and* the
ARIA role *and* the accessible name *and* the visible text *and* the CSS
variable *and* the declaring file *and* the region the handler runs in.

So `checkbox` finds `ds/toggle--states` because the run wrote down that the
toggle's role is `checkbox` — not because a model knows a toggle is a kind of
checkbox. `footer` finds the footer story because its id, its example and its
creator all say so.

The limit is the same fact read the other way: a vocabulary the suite does not
already produce is a vocabulary this cannot answer in. There is no index to
build, no model to ship, and no embedding to keep in step with the code.

## What the run writes down

Per subject, per field: the distinct values the subject carried, code-unit
sorted, capped at 200 distinct values per field with the overflow counted.

| field | from |
|---|---|
| `example` | the [composition](composition.md) census: the components this subject is the narrow example of |
| `names` | the [semantic snapshot](information.md): accessible name, description, `placeholder`, `alt`, `title` |
| `text` | the snapshot's text band, minus any text the [policy](ignores.md) digested as volatile |
| `components`, `createdBy` | every attributed boundary |
| `regions` | the [execution journal](journeys.md): the lexical names of the regions this subject entered |
| `files` | call-site [provenance](attribution.md) on the nodes, and the source index for each component |
| `roles` | the snapshot |
| `tokens` | the custom properties the boundaries resolved through |

The subject's own id is searched alongside these, at the heaviest weight, though
it is not part of the record — it is the one name the subject already had.

It is one pass over the instances every subject already reported, sharing the
composition census rather than deriving its own keys, so the two cannot disagree
about which story shows what.

Values are kept exactly as they were read — `TodoFooter`, `Clear completed`,
`--va-space-2` — and never pre-split. A hit prints the value it matched, so the
fact stands under the rank; and splitting is a rule, which applied at write time
would be applied to one side of the match only. The reader owns the rule and
applies it to the query and the value alike.

Digests never enter. A text the policy declared volatile reaches the snapshot as
`v1:…`, and a reader that matched on it would be matching a coordinate rather
than a word.

## How a query meets a value

`variance_locate {query}` splits the query by the rule the values are split by —
on separators and camel case, folding ASCII case and a trailing plural, keeping
the unsplit compound so `TodoFooter` typed whole still meets `TodoFooter`. A
term matches a value when every part of the term matches a token of the value,
exactly or by a prefix of three or more characters. Ten English function words
— `the`, `with`, `of` and their kind — are not indexed, and the answer names the
ones it dropped rather than silently narrowing the question.

The symmetry is the point. One rule, applied to both sides at read time, is a
rule a reader can predict from what the answer printed. A rule applied to the
values at write time is invisible, unversioned, and wrong in exactly the cases
where the reader typed the compound the writer had already broken up.

## How the hits are ordered

A hit ranks by how many of the query's terms it matched, then by the sum over
its matches of a per-field weight times how rare the matched word is in that
field, then by fewer boundaries, then by id.

The weights are fixed, and a field weighs by how strongly a name in it picks out
one subject rather than a family of them:

| 6 | 4 | 3 | 2 | 1 |
|---|---|---|---|---|
| `id`, `example` | `names`, `text` | `components`, `createdBy` | `regions`, `files` | `roles`, `tokens` |

Both factors are integers and the sum is an integer, so no float reaches the
sort and two machines cannot order the same hits differently.

Rarity is counted per field, not once across all of them, because the fields
hold different populations. Take a suite whose cards are declared in one module:
every subject in it enters the `createCard` region, so `card` as a *region* says
nothing about which subject you meant. Pooled, that one worthless field would
drag the word's rarity down everywhere, including in the two ids that say `card`
— and the subject actually named for the card would lose to a sibling that
matched on some other word.

## Three absences, told apart

A field the run could not read is absent from the report's field list, not
present and empty. No snapshot means no `names`, `text` or `roles`; no journal
means no `regions`; no source index means no `files`. A production build with
the owner links stripped has an empty `createdBy` on every subject — read, and
genuinely empty.

The answer says which of these it is looking at, per field, before it says what
matched, because *nothing matched* and *nothing was read* are answers with
opposite next steps. The cap is reported on the same terms: a subject whose
`text` was cut says how many values it lost.
[Three answers that look alike](locate.md#three-answers-that-look-alike) is how
to read the header that carries this.

## Where it is kept

The run report carries it, and a report is about one run — its verdicts, its
diffs, its docket. The lexicon is the one section of it that is not: the names a
suite holds change when the suite changes, and the question *which subject do I
mean* is asked far more often than a run happens.

So the lexicon is also written to the **suite index**, the binary artifact a run
leaves behind: the census, the count of subjects the suite holds that every
share in the census is taken over, the lexicon, and the commit they were read
at. Equal facts encode to equal bytes there, which is what lets a cache carry it
and a second machine recognise it.

That is what makes a reader possible where no run happened — a fresh checkout, a
pull-request comment, an agent orienting itself in a repository before it has
touched the branch. [Sharing an evaluation](sharing.md) is how the file gets
there: a directory, an action cache, a bucket, or a deployment, on terms where
losing it costs a rebuild and never a wrong answer.

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
scores 20 of 20 by scanning. So what this suite measures is agreement with the
reader, not a saving — the saving only exists on a suite whose ids do not fit in
one answer, and that is not what was measured here.

## What it refuses to be

**Not a search engine.** The corpus is a few hundred short names per subject and
the ranking is two integers and a string. No term frequency, because three chips
in one footer is a fact about a list and not a better match. No length
normalisation, because the size of a subject is already a rank key.

**Not evidence.** A wrong top hit costs one more call. The same wrong hit quoted
as a finding would cost a baseline, which is why nothing here carries a verdict,
a pixel count, or a file to open — only ids, and the tools that take them.

**Not a declaration.** Nothing in the lexicon was written by hand or annotated
for discovery, so there is no `@locate` tag to add to a component that is hard
to find. A query in a vocabulary the suite does not produce gets no hits and the
list of fields that were read.
