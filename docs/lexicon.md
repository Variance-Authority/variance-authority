# How search finds a subject

This is the recorded-vocabulary half of [orientation](orientation.md): use it
when you can describe a captured UI state but do not know its subject id. For
source names in the current checkout, use
[the workspace API](agent-workspace-api.md).

`grep`, ripgrep and find-in-files search the text of your files. This searches
what a run observed. Each run writes down — per subject — the ids, component
names, accessible names, visible text, roles, declaring files, custom
properties and covered regions it saw. That per-subject record of the words a
subject answered to is the **lexicon**, and search runs against it.

A **subject** is one named UI state you asked for and can ask for again, such as
`cart/empty`. So `checkbox` finds a toggle whose source never spells the word,
because the run read the rendered role off the accessibility tree; and
`--va-space-2` finds every subject that resolved through the token, because the
run read the cascade. Neither string need appear in any file you could grep.

Ask it with a description and get ids back:

```bash
variance ask locate --query "footer chips"
```

```text
7 of 15 subject(s) match `footer chips`.
Read: id, example, names, text, components, createdBy, files, roles, tokens. Not read: regions (no execution journal was read).

page/footer--counts · 7 boundaries · example of TodoFooter
  where: group `Filters` · src/todo/TodoFooter.tsx:41 · within Todos › Footer
  footer: id `page/footer--counts`; example `TodoFooter`; components `TodoFooter`; createdBy `TodoFooter`
  chips: components `Chip`
ds/chip--group · 4 boundaries · example of Stack
  where: group `Chips` · src/ds/ChipGroup.tsx:12
  chips: components `Chip`

next: variance_composition {subject: "page/footer--counts"} · variance_describe {subject: "page/footer--counts"}
```

Over MCP the same question is `variance_locate {query: "footer chips"}`.
[Find the subject you mean](locate.md) is the task page — what you need, how to
ask, how to read the answer. This page is what sits behind it: why a question
matched what it matched, what the record costs to keep, and why there is no
model to install.

**This is not a glossary.** Terms are defined on the page that owns each one,
and the table in [what every record means](information.md#the-words) lists
the ones a report uses.

**Nothing switches this on.** Every `variance run` that reads component
boundaries writes the record search reads: no option, no second pass, no
service. Where a run read no boundaries — a raster-only capture, or a suite
built on something other than React — there are no names to write, and the
answer says that rather than reporting no match.

A run reads a subject under many vocabularies at once. It takes the component
names off the fiber, the roles and accessible names off the accessibility tree,
the visible text off the DOM, the custom properties off the cascade, the files
off the [source index](source-index.md), the regions off the
[execution journal](journeys.md). The synonyms were observed rather than
inferred — by separate instruments pointed at the same subject for other
reasons, finished with the readings long before you asked a question.

## Why no thesaurus and no model

The usual way to find a thing you can only describe is to make the machine
understand the description: stem it, expand it through a thesaurus, embed it and
compare vectors. Each of those bridges the same gap — the corpus knows one name
for the thing, and you used a different one.

Here the corpus does not know one name. It knows the component name *and* the
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

## The gap that is left, and who closes it

A word the suite never says still finds nothing. You ask for `auth`; the screen
says *Sign in*, the component is `CredentialGate`, the file is
`session/entry.tsx`. Every reading of that subject is a name, and none of them is
your word. The answer is the fields that were searched and no hits — true, and no
use to you.

That gap is not closed here, and the reason is what sits on the other end of the
question. The thing asking is a model, with the ticket, the conversation and the
checkout in front of it. It already knows `auth` means `login`, `session`,
`credential`, `token`, `jwt`, and it knows which of those this codebase is in the
habit of writing. Translating a concept into likely names is the one part of this
that a model does well and a table does badly, so it belongs to the model, and
what is left — matching those names and ordering them the same way on every
machine — is the part a table does well.

That fixes the division in three parts:

- **The run writes down every name it read, per field, and interprets none of
  them.** Separate instruments, pointed at the subject for other reasons.
- **The reader matches words against those names and orders them with
  integers.** Three integers and a string, identical on every machine.
- **The caller brings the words.** Which word stands for which other word is a
  judgement about your repository, and the run never makes it.

[Ask in more than one vocabulary](locate.md#ask-in-more-than-one-vocabulary) is
that division as a habit: which kinds of name are worth trying, and what the
answer tells you when none of them lands.

## What the run writes down

Per subject, per field: the distinct values read from it, code-unit
sorted, capped at 200 distinct values per field with the overflow counted. Where
the cap fires it keeps the values the fewest other subjects share — see [what a
deep tree does to it](#what-a-deep-tree-does-to-it). A **boundary**, below, is
one component instance in the rendered tree.

| field | from |
|---|---|
| `example` | the [composition](composition.md) census: the shallowest component this subject is the narrow example of, past anything most of the suite also mounts |
| `names` | the [semantic snapshot](information.md): accessible name, description, `placeholder`, `alt`, `title` |
| `text` | the snapshot's text band, minus any text the [policy](ignores.md) digested as volatile |
| `components`, `createdBy` | every attributed boundary |
| `regions` | the [execution journal](journeys.md): the lexical names of the regions this subject covered |
| `files` | call-site [provenance](attribution.md) on the nodes, and the source index for each component |
| `roles` | the snapshot |
| `tokens` | the custom properties the boundaries resolved through |

The **census** is the run's own count of which component was mounted in how many
subjects, and a subject is the **narrow example** of a component when it shows
that component with the fewest other boundaries around it. Both are read off the
instances every subject already reported.

Values are kept exactly as they were read — `TodoFooter`, `Clear completed`,
`--va-space-2` — and never pre-split. A hit prints the value it matched, so the
fact stands under the rank; and splitting is a rule, which applied at write time
would be applied to one side of the match only. The query side owns the rule
and applies it to the query and the value alike.

Digests never leak. Text an [ignore](ignores.md) declared volatile — a clock, a
feed, an order number — is written into the snapshot hashed, as `v1:9a3f1c2e…`
rather than as words, and a query that matched on it would be matching a
coordinate rather than a word.

## The same pass writes the arrangement

The bags above tell you that one subject says `Carrier` and says *No active
contract on file*. They cannot tell you that the second sits beneath the first,
and that is most of what a description is: *the warning underneath the Carrier
field*, *the button to the right of the total*.

So the pass that fills the bags also writes down where each thing was. A node
earns a place when it bears a role, an accessible name, or words of its own;
everything else is scaffolding, and a screen built out of four wrappers per
control writes four entries rather than four hundred. Each recorded place is a
**landmark** — this page's word, not ARIA's — and has these fields:

| | |
|---|---|
| `role`, `name`, `text` | what it is, what it is called, and what it says — its own words only, so a container never inherits its button's sentence |
| `within` | the nearest enclosing landmark, not the nearest node, so containment survives any depth of wrapper |
| `box` | `[x, y, width, height]`, integers, from the layout the run resolved |
| `file`, `line`, `createdBy`, `handle` | where it is declared, who mounted it, and the test id the suite set on it, where it set one |
| `component` | the innermost component that owns it, off the fiber's owner chain |

Capped at 1,200 per subject, which clears the largest real screen with room,
keeping the named over the wordless and counting the rest. Where the cap fires
it rewrites `within` onto the entries that survived, so no record points at
something that is no longer there.

**`component` is the half that survives a production build.** The exact line an
element was written on comes from the JSX-source plugin, and a build strips it —
so on a built Storybook, which is the run you most want to ask, `file` and
`line` are absent from every landmark. The owner chain is not stripped. The
component that owns a thing is the source you would open to find it, and the
run already knows which files declare which components, so the lexicon stores
that join once — `declaredIn`, one row per component rather than a path on each
of ten thousand landmarks — and an answer prints a file either way.

`box` is absent rather than zeroed when the run resolved no layout. Ask *what is
under this* against such a run and you are told the run cannot say: document
order agrees with the screen often enough to be dangerous and not often enough
to be relied on. Containment is answered all the same, because `within` needs no
rectangles. [Asking where something sits](locate.md#ask-where-something-sits) is
the reading side.

## How a query meets a value

`variance_locate {query}` splits the query by the rule the values are split by —
on separators and camel case, folding ASCII case and a trailing plural, keeping
the unsplit compound so `TodoFooter` typed whole still meets `TodoFooter`. A
term matches a value when every part of the term matches a token of the value,
exactly or by a prefix of three or more characters. Ten English function words
— `the`, `with`, `of` and their kind — are not indexed, and the answer names the
ones it dropped rather than silently narrowing the question.

**The lexicon is served as an inverted index.** Every value is tokenised once
per report — token to the values containing it, values to their subject and
field — so a question costs what its own words touch: a lookup per term, a walk
over the prefix run for a stem, an intersection per term. It never scans the
subjects. The index is built on the first question asked of a report and kept
with it, and it is built from the same values the answer quotes, so the order
and the fact under it are read off one structure.

## How the hits are ordered

A hit ranks by how many of the query's terms it matched, then by the sum over
its matches of a per-field weight times how rare the matched word is in that
field, then by fewer boundaries, then by id. The third key prefers
the subject that shows your words with less else around it.

The weights are fixed, and a field weighs by how strongly a name in it picks out
one subject rather than a family of them:

| 6 | 4 | 3 | 2 | 1 |
|---|---|---|---|---|
| `id`, `example` | `names`, `text` | `components`, `createdBy` | `regions`, `files` | `roles`, `tokens` |

Both factors are integers and the sum is an integer, so no float is involved in the
sort and two machines cannot order the same hits differently.

Rarity is counted per field, not once across all of them, because the fields
have different populations. A word can be worthless in one field and decisive in
another: if every subject covers a `createCard` region, `card` as a *region*
says nothing, while `card` in an id still picks out the two subjects named for
it. Pooling the counts would spend the word everywhere on the strength of the
worthless field.

### Say a start point, and a word is worth something else

Name a path with `--from` and only the subjects produced by a file that path
reaches along the imports are searched; name one with `--to` and it is the
subjects that reach it. A path is said at one of three widths, narrowest first:

```bash
variance ask locate --query chip --from app/dispatch/page.tsx   # that file
variance ask locate --query chip --from 'app/dispatch/*'        # its folder
variance ask locate --query chip --from app/dispatch/           # everything under it
```

Over MCP it is the same argument under the same name — `variance_locate {query:
"chip", from: "app/dispatch/"}` — and `docs_search` takes it too, over source
symbols instead of subjects. One path vocabulary, one resolver, whichever
question names a path. Which way each argument walks, why the bare folder is
the wider of the two, and what a path the checkout does not hold is answered
with, are [say where to look](locate.md#say-where-to-look).

The subjects ruled out never reach the ranking, and that is the visible half.
The half that belongs on this page is rarity: rarity is a count over subjects,
so counting it inside the scope rather than over the suite reorders what is
left. A word every screen in the application says is worth nothing. A word
every screen *in this area* says is worth nothing *here*. Those are different
statements, and inside an area the second one sorts — which is why the answer
reports how many subjects it searched, and not only how many matched.

## What a deep tree does to it

A subject in a real application is not two boundaries deep. It is a screen under
a router under a store provider under a theme provider under three higher-order
components, and the tree that reaches the thing you asked about can be hundreds
of boundaries tall. Almost none of that is what the subject is about, and all of
it has names.

One rule handles it, and it is a count rather than a list:

> A component almost every subject mounts is structure, not subject matter.

Nothing in that count knows that `withStyles(Account)` is a higher-order
component, that `Ctx.Consumer` is a context consumer, that a class component is
a class component, or that a minified `aL` is a decorator a build renamed. It
knows that more than half the suite mounts it, which is what the rule needs.

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
subjects share, and orders what survives by code unit, so the choice is by worth
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
to read the header that says it.

## Where it is kept

The run report includes it, and a report is about one run — what changed, what
each subject's comparison decided, and what the run left for somebody to decide.
The lexicon is the one section of it that is not: the names a suite uses change
when the suite changes, and the question *which subject do I mean* is asked far
more often than a run happens.

So the lexicon is also written to the **suite index**, the binary artifact a run
leaves beside its report: the census, the subject denominator the census's
shares are counted against, the lexicon, and the commit they were read at. Equal
facts encode to equal bytes there, which is what lets a cache store it and a
second machine recognise it.

That is what a second machine reads instead of deriving the same thing again.
Mainline's names were read on a runner that no longer exists, and a branch that
starts from the same tree would spend a source scan, a browser and a composition
pass arriving at bytes that are already written down. [Sharing an
evaluation](sharing.md) is how the file gets there: a directory, an action
cache, a bucket, or a deployment, on terms where losing it costs a rebuild and
never a wrong answer.

## What it costs

The record is written in the pass the run already makes over its instances, so
what it adds to a run is bytes rather than a stage.

**Storage runs 38 to 51 bytes per component boundary**, measured across suites.
That is a spread rather than a constant, so count the boundaries your suite
reports, multiply by the top of it, and plan for that. [What a suite costs at
scale](scale.md) lists the per-subject figures and prices the source index and
the [execution record](execution-record.md) beside them.

Reading costs once. The index a question runs against is built on the first
question asked of a report and kept with it: a lexicon generated at Material
UI's shape — 4,705 subjects, ninety-odd thousand kept values — goes through that
build in under a tenth of a second on one warm machine, so the first question of
a session pays about that and every question after it pays nothing.

## What it is measured at

Three suites, of three different shapes. Each question was written by an author
who was shown only roles, accessible names and visible text under opaque labels,
never an id or a file path, and the labels were resolved to subjects afterwards.
So a question is phrased the way somebody who has seen the product would phrase
it, and never the way somebody who has seen the index would.

| | todomvc | material-ui | a product web app |
|---|---|---|---|
| subjects | 15 | 4,705 | 572 |
| built by | a dev server | unbundled sources | a production Storybook build |
| questions | 20 | 25 | 20 |
| the author's subject is the first hit | 19 | 7 | 3 |
| among the first three | 20 | 9 | 7 |
| on the printed page of eight | 20 | 10 | 12 |

Read that as the shape it is. On a suite whose ids fit in one answer the
ranking agrees with the author almost every time — and so does an agent that
reads the fifteen ids and ignores the rank. On four thousand subjects the first
hit is right for roughly a quarter of questions and the page of eight shows the
answer for two fifths. **On these suites the tool narrows the field; it does not
pick the answer.**

### Why the words run out

The rank's second key is how rare a matched word is, and on a large suite the
words an author uses are not rare. Of the words the product-app questions
matched, a fifth appear in more than half of its 572 subjects — `section` by
568, `page` by 567, `states` by 566 — at which point the word is being asked to
distinguish between subjects that all have it.

material-ui does not have this problem, and that is the more useful fact: its
median matched word appears in 1.1% of the suite, and not one matched word
appears in more than half. A library that names everything after exactly one
component has a vocabulary that is already almost unique. A product named in
product language does not, and neither does a repository where many teams name
similar things similarly.

### What a starting point is worth

Every count above asks whether the top hit is the author's *subject*. That is
the wrong target for the question this answers. You are not looking for a story;
you are looking for the place the thing is written, and one file is usually
shown by several stories. Picking a different story that opens the same file is
not a miss.

So the questions were asked again mechanically — three hundred of them, seeded
and re-runnable, each one a landmark's own words with the folder of the file
that landmark was written in, said as a path, as the starting point — and scored
on the file the answer prints rather than on the id:

| another product suite · 165 subjects | within the scope | whole suite |
|---|---:|---:|
| subjects the question is put to, mean | 72 | 165 |
| **the top hit names the right place** | **68.0%** | **55.7%** |
| the right place is within three | 81.4% | 75.7% |
| the top hit is the author's subject | 21.9% | 18.7% |
| no hits at all | 3.0% | 2.3% |

Read the last two rows against the two above them. The top hit is the author's
own story one time in five and names the right file two times in three, and the
gap between those two numbers is entirely stories that show the same file. Score
this on the file you get, not on the id.

A start point is worth about twelve points of first place and six by the third
answer. Half of what it does on this suite is order the same few files better
rather than put a file on the page that was not already there, which is the
shape to expect wherever a scope stays wide, and this one does: naming a folder
of four files still puts the question to two subjects in five, because the
imports run from those four files into a provider every screen is built on.

The other two suites are absent because no start point is accepted for either:
neither run wrote any files — a production build names no source, and Material
UI's field was read and is genuinely empty — so there is no coordinate to start
from and the whole-suite row is the only one there is. On the component library
it is 46.0%, against 4,705 subjects and with no line to print: the place an
answer hands over there is the component that owns the landmark and the files
declaring it, which is somewhere to open rather than a coordinate, and it is
said differently for that reason.

### What these numbers are, and are not

They are counts against fixed denominators, taken inside one run. No number here
is a ratio of two timed runs, so none of them changes on a slower machine.

They are not a benchmark against another tool, and they do not establish that a
question an author could not answer from names alone is answerable at all: four
of the material-ui questions describe components the suite does not contain, and
those are counted as misses against the denominator rather than removed from it.

Twenty-five questions cannot separate two rankings that differ slightly — a
single question changing is a twenty-fifth of the score. They are enough to
separate *scoping* from *not scoping*, which changes several questions at
once, and they are not enough to tune a weight. No weight in this page was
chosen by fitting these questions.

## What it refuses to be

**Not a search engine.** The corpus is a few hundred short names per subject and
the ranking is three integers and a string. No term frequency, because three chips
in one footer is a fact about a list and not a better match. No length
normalisation, because the size of a subject is already a rank key.

**Not evidence.** A wrong top hit costs one more call. The same wrong hit quoted
as a finding would cost a baseline, which is why nothing here returns a verdict
— the decision a comparison made about one subject — or a pixel count, or a
file to open. Only ids, and the tools that take them.

**Not a declaration.** Nothing in the lexicon was written by hand or annotated
for discovery, so there is no `@locate` tag to add to a component that is hard
to find. A query in a vocabulary the suite does not produce gets no hits and the
list of fields that were read.
