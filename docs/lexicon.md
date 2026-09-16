# Every name a run saw

**To search a suite, go to [find the subject you mean](locate.md).** That page
is the task: what you need, how to ask, how to read the answer. This one is what
sits behind it, for when you want to know why a question matched what it
matched, what it costs on a suite your size, or why there is no model to
install.

The short version: searching here works without a thesaurus, an embedding or a
trained model, and it works because of something a run was already doing.

A run reads a subject under many vocabularies at once. It takes the component
names off the fiber, the roles and accessible names off the accessibility tree,
the visible text off the DOM, the custom properties off the cascade, the files
off the [source index](source-index.md), the regions off the
[execution journal](journeys.md). **The synonyms are not inferred, they were
observed** — by separate instruments that were pointed at the same subject for
other reasons, and that were finished with the readings long before anybody
asked a question.

Writing those readings down per subject is what turns a description into ids.
That record is the **lexicon**.

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
already produce is a vocabulary this cannot answer in. There is no model to
ship and no embedding to keep in step with the code — what a question runs
against is an inverted index, built from the names the run already wrote down.

## What the run writes down

Per subject, per field: the distinct values the subject carried, code-unit
sorted, capped at 200 distinct values per field with the overflow counted. Where
the cap fires it keeps the values the fewest other subjects hold — see [what a
deep tree does to it](#what-a-deep-tree-does-to-it).

| field | from |
|---|---|
| `example` | the [composition](composition.md) census: the shallowest component this subject is the narrow example of, past anything most of the suite also mounts |
| `names` | the [semantic snapshot](information.md): accessible name, description, `placeholder`, `alt`, `title` |
| `text` | the snapshot's text band, minus any text the [policy](ignores.md) digested as volatile |
| `components`, `createdBy` | every attributed boundary |
| `regions` | the [execution journal](journeys.md): the lexical names of the regions this subject entered |
| `files` | call-site [provenance](attribution.md) on the nodes, and the source index for each component |
| `roles` | the snapshot |
| `tokens` | the custom properties the boundaries resolved through |

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

## The same pass writes the arrangement

The bags above tell you that one subject says `Carrier` and says *No active
contract on file*. They cannot tell you that the second sits beneath the first,
and that is most of what a description is: *the warning underneath the Carrier
field*, *the button to the right of the total*.

So the pass that fills the bags also writes down where each thing was. A node
earns a place when it bears a role, an accessible name, or words of its own;
everything else is scaffolding, and a screen built out of four wrappers per
control writes four entries rather than four hundred. Each one carries:

| | |
|---|---|
| `role`, `name`, `text` | what it is, what it is called, and what it says — its own words only, so a container never inherits its button's sentence |
| `within` | the nearest enclosing **landmark**, not the nearest node, so containment survives any depth of wrapper |
| `box` | `[x, y, width, height]`, integers, from the layout the run resolved |
| `file`, `line`, `createdBy`, `handle` | where it is declared, who mounted it, and its test id |
| `component` | the innermost component that owns it, off the fiber's owner chain |

Capped at 400 per subject, keeping the named over the wordless and counting the
rest. Where the cap fires it rewrites `within` onto the entries that survived,
so no record points at something that is no longer there.

**`component` is the half that survives a production build.** The exact line an
element was written on comes from the JSX-source plugin, and a build strips it —
so on a built Storybook, which is the run you most want to ask, `file` and
`line` are absent from every landmark. The owner chain is not stripped. The
component that owns a thing is the source you would open to find it, and the
run already knows which files declare which components, so the lexicon carries
that join once — `declaredIn`, one row per component rather than a path on each
of ten thousand landmarks — and an answer prints a file either way.

`box` is absent rather than zeroed when the run resolved no layout. A reader
asking *what is under this* against such a run is told the run cannot say, which
is the one honest answer: document order agrees with the screen often enough to
be dangerous and not often enough to be relied on. Containment is answered all
the same, because `within` needs no rectangles.

This is a representation, not an instrument. Nothing new is captured for it, no
run is configured for it, and because the words and the places come out of one
walk of one tree they cannot disagree about what was on the screen.
[Asking where something sits](locate.md#ask-where-something-sits) is the reading
side.

## How a query meets a value

`variance_locate {query}` splits the query by the rule the values are split by —
on separators and camel case, folding ASCII case and a trailing plural, keeping
the unsplit compound so `TodoFooter` typed whole still meets `TodoFooter`. A
term matches a value when every part of the term matches a token of the value,
exactly or by a prefix of three or more characters. Ten English function words
— `the`, `with`, `of` and their kind — are not indexed, and the answer names the
ones it dropped rather than silently narrowing the question.

**The lexicon is served as an inverted index.** Every value is tokenised once
per report — token to the values holding it, values to their subject and field
— so a question costs what its own words touch: a lookup per term, a walk over
the prefix run for a stem, an intersection per term. It never scans the
subjects. The index is built on the first question asked of a report and kept
with it, and it is built from the same values the answer quotes, so the order
and the fact under it are read off one structure.

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

## What a deep tree does to it

A subject in a real application is not two boundaries deep. It is a screen under
a router under a store provider under a theme provider under three higher-order
components, and the tree that reaches the thing you asked about can be hundreds
of boundaries tall. Almost none of that is what the subject is about, and all of
it has names.

One rule handles it, and it is a count rather than a list:

> A component almost every subject mounts is structure, not subject matter.

Nothing in the fold knows that `withStyles(Account)` is a higher-order
component, that `Ctx.Consumer` is a context consumer, that a class component is
a class component, or that a minified `aL` is a decorator a build renamed. It
knows that more than half the suite mounts it, which is enough, and which keeps
working on frameworks and build settings nobody here has seen.

It decides two things:

**Which component a subject is the example of.** The shallowest boundary is
whatever the harness mounted first, and answering with it gives every subject in
a suite the same answer — one value for the whole field, which is a field that
says nothing. So the example is the shallowest boundary that is *not* structure.
Where the descent finds nothing — a suite too small for anything to be
distinguishing — it answers as the shallowest rule would, so it can name more
subjects than that rule and never fewer.

**What a cap keeps.** Two hundred values is generous until a tree is six hundred
boundaries tall, and then it is a choice. Code-unit order would make that choice
by spelling: keep `Anonymous` and `Connect(Account)`, drop the one component the
subject is about. So where a cap fires it keeps the values the fewest other
subjects hold, and orders what survives by code unit, so the choice is by worth
and the file is still byte-identical between two machines.

Neither rule deletes anything from a report or hides a value from a query. A
structural component is still in `components`, still matched, still printed when
it matches — and rarity already prices it at close to nothing.

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

That is what a second machine reads instead of deriving the same thing again.
Mainline's names were read on a runner that no longer exists, and a branch that
starts from the same tree would spend a source scan, a browser and a composition
pass arriving at bytes that are already written down. [Sharing an
evaluation](sharing.md) is how the file gets there: a directory, an action
cache, a bucket, or a deployment, on terms where losing it costs a rebuild and
never a wrong answer.

## What it is measured at

Three suites, of three different shapes. Each question was written by a reader
who was shown only roles, accessible names and visible text under opaque
handles, never an id or a file path, and the handles were resolved to subjects
afterwards. So a question is phrased the way somebody who has seen the product
would phrase it, and never the way somebody who has seen the index would.

| | todomvc | material-ui | a product web app |
|---|---|---|---|
| subjects | 15 | 4,705 | 572 |
| built by | a dev server | unbundled sources | a production Storybook build |
| questions | 20 | 25 | 20 |
| the reader's subject is the first hit | 19 | 7 | 3 |
| among the first three | 20 | 9 | 7 |
| on the printed page of eight | 20 | 10 | 12 |

Read that as the shape it is. On a suite whose ids fit in one answer the
ranking agrees with the reader almost every time — and so does an agent that
reads the fifteen ids and ignores the rank. On four thousand subjects the first
hit is right for roughly a quarter of questions and the page of eight holds the
answer for two fifths. **On these suites the tool narrows the field; it does not
pick the answer.**

### Why the words run out

The rank's second key is how rare a matched word is, and on a large suite the
words a reader reaches for are not rare. Of the words the product-app questions
matched, a fifth are held by more than half of its 572 subjects — `section` by
568, `page` by 567, `states` by 566 — at which point the word is being asked to
distinguish between subjects that all have it.

material-ui does not have this problem, and that is the more useful fact: its
median matched word is held by 1.1% of the suite, and not one matched word is
held by more than half. A library that names everything after exactly one
component has a vocabulary that is already almost unique. A product named in
product language does not, and neither does a repository where many teams name
similar things similarly.

### Say the starting point as a path

A starting point is a place, and the most exact place you have is usually the
file already open in front of you. Give it as a path and it is read as one:

```
from: app/about-us/page.tsx    the file itself, and only what it shows
from: app/about-us/*           the layouts and anything else beside it
from: app/about-us/            the same, for when you remember a direction
from: app/*/page.tsx           one segment you do not want to name
```

The run of segments has to appear entire and in order, so a path answers the
same whether the run recorded it rooted or not, and whether you paste the
absolute path your editor gives you or the tail you remember. A path is matched
only against the files a subject was seen in — nothing a screen *says* can
answer it.

Two absolute paths of the same depth under different roots are left alone: they
share a tail and disagree above it, nothing in a run says which of its leading
segments are its root, and a rule loose enough to join them would join
`apps/web/…/Button.tsx` to `apps/admin/…/Button.tsx`.

A word still works and means what it did — `billing` names the area — but where
you have a coordinate, give the coordinate.

### What a starting point is worth

The same questions, answered inside the directory the answer lives in rather
than across the whole suite:

| | material-ui | a product web app |
|---|---|---|
| how much narrower the field is | 39x | 11x |
| first hit, whole suite | 7 of 25 | 3 of 20 |
| first hit, within the scope | 10 of 25 | 9 of 20 |
| within three, whole suite | 9 of 25 | 7 of 20 |
| within three, within the scope | 12 of 25 | 14 of 20 |

A scope roughly triples the product app's first-hit count. It is the largest
single effect measured here, and it is larger on the suite whose vocabulary is
saturated — which is the case for scoping: a scope restores the distinctions a
shared vocabulary has spent.

### The rank is not what you came for

Every count above asks whether the top hit is the reader's *subject*. That is
the wrong target for the question this answers. You are not looking for a
story; you are looking for the place the thing is written, and one file is
usually shown by several stories. Picking a different story that opens the same
file is not a miss.

So the same questions were asked again mechanically — three hundred of them,
seeded and re-runnable, each one a landmark's own words with a directory of its
file as the starting point — and scored on the file the answer prints rather
than the id:

| | a 2019 application | a component library |
|---|---|---|
| subjects | 166 | 4,705 |
| lines kept by the build | 91.7% of landmarks | none |
| the top hit is the reader's subject | 22.7% | 13.0% |
| **the top hit names the right place** | **68.3%** | **67.7%** |
| the right place is within three | 83.0% | 70.7% |
| the top hit names it without a starting point | 55.7% | 46.0% |

Read the second and third rows together. On the library the top hit is the
reader's own story one time in eight and the right place two times in three,
and the gap between those two numbers is entirely stories that show the same
component. A measure that counts only the id reports a tool five times worse
than the one you are using.

The library row is the harder case in every respect: twenty-eight times the
subjects, and a production build that kept no line anywhere, so there is no
file to print and the answer falls back to the component that owns the landmark
and the files declaring it. It is a place to open rather than a coordinate,
which is why it is said differently, and it still answers two questions in
three.

Whether the scope is applied before the rank or after it is very nearly not a
question. Asked across every query the suites' own names produce against every
domain they contain — 14,479 query-and-scope pairs on one, 3,479 on the other —
re-counting rarity inside the scope changes the *first answer* in 40 pairs and
55 pairs. Scoping is worth doing; doing it first is worth almost nothing, which
means the cost of the two orders decides between them and not their quality.

### What these numbers are, and are not

They are counts against fixed denominators, taken inside one run. No number here
is a ratio of two timed runs, so none of them changes on a slower machine.

They are not a benchmark against another tool, and they do not establish that a
question a reader could not answer from names alone is answerable at all: four
of the material-ui questions describe components the suite does not contain, and
those are counted as misses against the denominator rather than removed from it.

Twenty-five questions cannot separate two rankings that differ slightly — a
single question moving is a twenty-fifth of the score. They are enough to
separate *scoping* from *not scoping*, which moves several questions at once,
and they are not enough to tune a weight. No weight in this page was chosen by
fitting these questions.

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
