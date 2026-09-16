# Spec 0039 — a subject is found from a description

**Missing:** the suite where it matters, and four fields. The arrangement half
has landed and is unmeasured, which makes item 1 the whole of this spec. The lexicon and the
structure rows reach the report, `variance_locate` ranks over them and
`variance_composition {subject}` prints them, and the only measurement is on
fifteen subjects, where the summary an agent already reads scores 20 of 20 by
scanning. Nothing measures the tool where the summary does not fit in one
answer. The same walk now writes landmarks — role, name, own text, enclosing
landmark, rectangle, file and line — and `variance_locate` reads them when the
query carries a relation, on no more evidence than ten unit tests over three
fixture surfaces. The lexicon carries no story file or line, no state keys, no
co-occurrence, and the recall prints rows rather than the tree.
**Built on:** [ADR-0057](../context/adr/0057-the-run-writes-every-name-it-saw.md)
(the run writes every name; order is orientation),
[ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md) (the
regions a subject entered are places, and the lexicon's `regions` field is a
reader of them), [ADR-0035](../context/adr/0035-a-node-stands-in-every-component-above-it.md)
(what a boundary is), [0038](0038-a-journey-is-read-against-the-committed-tree.md)
(the name `anon#n` that this cannot find either).

## Purpose

An agent that holds a description and needs a subject id should get one from
the run, with the fact under the order printed, on a suite of any size. An
agent that holds a subject id should get what the subject is made of without
re-rendering it. Both exist. What is missing is the proof that the first earns
its place, and the fields that would let a description reach what the run does
not yet write down.

## What would discharge it

**1. The suite where the summary does not fit.** A generated plan of a few
hundred subjects beside todomvc — a design system of forty components and the
pages that mount them, with names drawn from a fixed list so the measurement
is the same bytes every run — and the twenty-questions file run against it.
The claim to gate on is a count: first-hit and within-three over the questions,
and refusals over the questions with no answer, each an integer against a
fixed denominator. No ratio of timed runs anywhere in it.

Half the questions must carry a relation — *the warning under the carrier
field*, *the button right of the total* — because that half is what the
arrangement was written for, and each of those needs a decoy in the corpus: a
second surface saying the same words in the wrong order, and a second thing in
the same relation on the right surface. A question whose corpus has no decoy
measures nothing, because a reader ranking on words alone answers it.

Two counts belong to that half alone. **Matched on place**: the share of
answers where nothing in the relation said the asked-for word, which is the
rate at which the reader is being handed a landmark rather than a match, and
is expected to be high — a screen says `role=status`, a person says *warning*.
And **refusals**: a spatial question against a reading with no layout must
refuse, and the count of refusals must equal the count of such questions
exactly. A corpus rendered under jsdom resolves no layout at all, so it
measures containment and the word half, and cannot measure the rest.

**2. The story's own file and line.** The run does not hold `stories.tsx`, and
the render already carries what the props became, so the story source is not
indexed. What the plan does hold is where each subject was declared, and a
`declared` field — file and line of the subject's own declaration, as the
source index already holds it for components — would let `variance_locate
{query: "stories.tsx:41"}` answer. Derived from the plan, never parsed from a
story body.

**3. State keys.** The semantic snapshot carries `pressed`, `checked`,
`expanded` as keys with values. The keys are vocabulary a person uses — *the
pressed chip* — and the values are state. A `states` field holding the keys a
subject's nodes carry, never the values, is one more column in the fold.

**4. Full-tree recall.** The rows fold on component, depth, enclosing boundary
and creator, which loses which of the three `TodoItem` rows the second
`Toggle` sits under when the counts disagree. A tree — each row carrying its
parent row — is one more integer per row and no more digests, and it prints
as an indented tree rather than an indented list. Taken only if a reader
needs the parent, because the flat rows are what the report can carry at
three hundred subjects.

**5. Co-occurrence, printed.** Terms that share subjects can expand a query —
`filter` reaching `chip` and `pressed` because the three occur together. On
fifteen subjects it is noise; on three hundred it is a signal. Ranked under
exact hits, never applied to a term that occurs nowhere, and printed on the
answer as the expansion it is, so a hit through it is still a fact the reader
can check. Taken only after item 1 shows the exact hits fall short.

## What it forecloses

**A float in a sort key, a synonym table, a model.** ADR-0057 rules them out,
and nothing here reopens them: co-occurrence is counted, not weighted.

**Indexing `anon#n`.** A region named by ordinal matches nothing anyone
types, and spec 0038 owns the name.

**A synonym table from the product's language to the platform's.** *Warning*
is not `status`, *field* is not `combobox`, and the table joining them is
declared rather than derived and wrong after the first refactor. The answer
says which landmark is in the relation and that it matched on place rather than
on words, and the agent asking is the model that would have written the screen.

**Answering a spatial question from document order.** It agrees with the screen
often enough to be dangerous and not often enough to be relied on. Without
rectangles the answer is a refusal, and containment is answered from `within`.

**A run id on the lexicon.** The suite in item 1 is one run compared to
itself; nothing joins its names to another run's.

## What one corpus could already say

Containment needs no rectangles, so the structure-only capture set can be asked
now. Four hundred questions were built from the record itself — *the `X` inside
the `Y`*, taken from a landmark and its enclosing landmark — and asked against
all 4,705 subjects at once.

```
asked 400 · right place first 66 · right place in five 116 · no answer 36
the median question is answered identically by 36 other subjects
```

That last line voids the first three. A component library's capture set is a
prop matrix: the same tree recorded a few dozen times over, so most questions
have no single right answer and recall is bounded by ambiguity rather than by
the reader. **Only the questions with exactly one holder in the corpus can score
the reader** — 66 of the 400:

```
unique questions 66 · right place first 47 · in five 49
misses: 7 right surface, wrong place · 6 wrong surface · 6 no answer
```

The dominant miss was on the correct surface — 16 of the 28 — and was not a
ranking flaw. A phrase names the thing and what it sits in, the two tie on
words, and with no rectangles document order broke the tie towards the
container, which is never what was meant. Depth is the size that needs no
layout, so the enclosed one now wins: 38 right first became 47, and that class
of miss fell from 16 to 7.

The plain description — *the X Y*, no relation word, which is what the first
five minutes of a task actually holds — is measured the same way, through the
subject search and the place it now prints:

```
asked 400 · every answer carried a place 400 · right surface first 53 of 66
the place on that surface right 38 of 66 · 1.2 ms per question
```

Every answer ends at a place rather than at an id, which is the structural
half. The quality half is bounded by the subject choice above it: of the 53
questions whose surface was right, the place on it was right 38 times.

Neither number discharges item 1. Both price the surface-choosing half on a
corpus that cannot pose the question, and say nothing about the half that needs
a browser: no landmark in that suite carries a rectangle, and none carries a
file either, so *ends at a file* is asserted by the tests and measured nowhere.

## What a real application did to the cap

A product web app — 572 subjects, a browser, layout resolved — was folded to
price the landmark half. Every subject that supplied a snapshot carried a
rectangle on every landmark, which is the half the component library cannot
show. The sizes:

```
subjects with landmarks 543 · landmarks 13,084 · min 1 · p50 9 · p90 52 · p99 227
landmarks 1,799,622 B of a 7,835,647 B report — 23.0%
```

And the cap fired. Four subjects sat pinned at four hundred, dropping 1,973
landmarks between them; their true sizes were roughly 1,179, 926, 836 and 632.
Those four are the application's largest screens, which are the ones somebody
most needs to be oriented on, and what a cap cuts off such a screen is its
bottom — where *the warning underneath the field* lives. `LANDMARK_CAP` is
twelve hundred, which clears the largest observed screen with room and leaves
the other 539 subjects exactly as they were, an order of magnitude below it.

Re-run at twelve hundred, the same suite writes 15,057 landmarks and elides
none — exactly the 1,973 the cap had been cutting — with the largest screen at
1,179 and the next percentile still at 231.

The same run settles which attribution survives a production build. `file`,
`line`, `handle` and `createdBy` were present on **0 of 15,057** landmarks; the
owner chain on **all** of them. So `component` and `declaredIn` carry the place
instead, and the join closes completely: 39 distinct components on the
landmarks, all 39 resolving through a `declaredIn` of 395 rows and 26 KB. Every
landmark on every subject ends at a file.

**And the file is worth what the build left of it.** All 39 names are minified
— one and two letters, plus `Anonymous` — and all 156 paths they join to are
bundle chunks. The mechanism is whole and the answer reads `in \`q\` ·
assets/…`, which is not orientation. Nothing in the reader can repair that: the
names and the modules were destroyed before the run started, and the cure is on
the build side — the JSX-source instrumentation, or a build that keeps function
names — which [attribution](../attribution.md) already states. What this
measurement establishes is the division: the join is not the missing half, and a
build that keeps its names is.

## The relation, measured where there are rectangles

The component library could not pose a spatial question: none of its landmarks
carries a box. The product run does, on all of them, so *beneath* is finally
askable. Ground truth is built the same way as the containment set and from the
same record — a landmark whose rectangle sits below a sibling's under the same
enclosure, with the two overlapping horizontally — giving 5,353 pairs, of which
400 were asked.

A real application is far less ambiguous than a prop matrix: the median question
here is held by **2** surfaces rather than 36, and 199 of the 400 are held by
exactly one. Those 199 are the scoreable set:

```
right surface first 180 · right place first 122 · right place in five 136
misses: 58 right surface wrong place · 18 wrong surface · 1 no answer
```

The misses were then classified against the record rather than read:

```
of the 58 — 38 stand in the asked relation to the asked anchor
             18 resolved a different anchor · 2 neither
             0 confused a thing with what encloses it
```

So the reader picks the anchor the question named nine times in ten, and what it
returns is genuinely beneath that anchor four times in five. What it cannot do
is choose between several things that are all beneath one anchor — which is not
a ranking defect but the question being short one word, and is exactly what
`also beneath` is printed for: the meant thing appears there in 17 of the 58,
putting it inside the first answer 139 times of 199.

The anchor was then the lever, and six of its eighteen misses were the same
mistake the plain description had already made: a candidate that *encloses* the
anchor, answering the question because something stands beneath it too. The
relation branch kept the first candidate that answered at all, so a
higher-scoring container ended it before the thing on it was reached. Every
candidate that answers is now weighed, and containment picks between them — the
rule already written for the no-relation branch, applied where it was missing.
On that corpus it moved right-place-first from 122 to 128 of 199 and took that
class of wrong anchor from six to zero.

**Those two sentences are the last ones about that corpus, because its report no
longer exists.** It was written to a working directory that has since been
cleared, and the numbers above cannot be re-derived. They are recorded as what
was seen, not as something a reader can check, and nothing below rests on them.

## What reproduces

Two corpora answer the same questions from reports that persist, under seeded
samples. The second is new: an application from 2019 on a Storybook five major
versions behind this one, built with the JSX-source transform left on, which
makes it the first *built* Storybook here whose landmarks carry a line.

`beneath`, on the 2019 application — 400 asked, 108 held by a single surface:

```
right surface first 85 · right place first 63 · right place in five 79
misses: 22 right surface wrong place · 23 wrong surface · 0 no answer
```

`inside`, on the component library — 34 questions held by a single surface, and
on the 2019 application, 400 questions built the same way:

```
library     20 of 34 first
2019 app   237 of 400 right surface · 219 right place · all 219 with a line
```

The containment rule was then measured against its own absence, by taking the
best-scoring answerable candidate instead:

```
2019 app, beneath   63 → 63   unchanged
library, inside     21 → 20   one worse
```

**So on both corpora that can be re-measured, the rule is neutral or costs one
question.** Its entire demonstrated benefit is on the corpus that is gone. What
survives the loss is not the six-question gain but the reason: `enclosesTrueAnchor`
is **0** on both remaining corpora, and it was 6 before the rule on the one that
had the shape. A rule that removes a miss class costs nothing where the class is
empty, which is what neutral-on-one and minus-one-on-the-other looks like. It is
kept on that argument, and the argument is weaker than a number.

What the 2019 application shows instead is where the anchor now goes wrong:

```
of the 22 — 16 resolved a different anchor · 4 stand in the asked relation
             1 encloses the truth · 1 is enclosed by it
of the 16 — 14 landed on a node saying the same words somewhere else
             0 enclose the true anchor
```

**The dominant miss is no longer structural.** An application that renders the
same row many times says the same words in many places, and the question names
one of them without saying which. That is the question being short a word again,
and the answer prints the alternatives: the meant place is under `also beneath`
in 17 of the 22.

Nothing here touches item 1: this is still a corpus asking itself questions
built from its own record, not a person asking about a screen.

## And on a build that kept its source, the place is the file

The product application settled one half of the attribution question and left
the other open: the component-to-files join was structurally complete and
practically empty, because a production build had stripped every `file`, `line`,
`handle` and `createdBy` from all 15,057 of its landmarks. What it could not
say is whether the join was the missing half or the build was.

The 2019 application answers it, because its build leaves the JSX-source
transform on. 165 subjects, 6,264 landmarks:

```
box        6,264  100%      component  6,264  100%
file       5,743  91.7%     createdBy  4,107  65.6%
line       5,743  91.7%     handle         0  0%
```

```
place handed over:  file and line 5,743 · component → file 521 · nothing 0
231 distinct files, every one a source file · 122 component names, none minified
declaredIn joins every component it is asked about
```

**The build was the missing half.** Nine landmarks in ten name the file and the
line somebody opens, and the tenth still names a component the source index
resolves — so no landmark on this application answers *where* with nothing. The
same reader, on the same code, printed a minified name and a bundle chunk one
corpus earlier. What separates them is a transform in a config file, which is
why the page says so rather than promising a line it cannot always produce.

It also confirms the cap from the other side. The largest subject here holds 421
landmarks against a cap of 1,200, and nothing was elided on any of the 165 — the
headroom the product application's four pinned screens argued for is headroom
this one never needs.

## And the word that was missing was not a better description

Every measurement above asks the whole suite. A person in their first five
minutes is not holding the whole suite: they know, roughly, which part of the
application the change is in, and that knowledge was going nowhere, because
folded into the query it is just three more words to match — and a product says
its own name on most of its own screens, so those words rank badly.

`from` takes it as a separate argument and matches it against the fields that
say where code is: the id, the component a subject is the example of, the
components it holds, who mounted them, the files declaring them, the regions its
journey entered. Never `names`, `text`, `roles` or `tokens`. A button labelled
*Billing* on the account screen is the thing being looked for wearing the
clothes of the place to look, and a scope that read visible text would return it
first.

Three hundred questions on each of the two corpora that persist, the questions
taken from the record — a landmark's own words, asked as a person holds them —
and the start point typed as a caller would type it: the story group on one, the
component directory on the other. Both seeded, both re-runnable.

```
                subjects  scope  narrower   first hit        within three
2019 app        165       76     2.2x       52 → 75          100 → 157
component lib   4,705     130    36.1x      30 → 48          50 → 74
```

The gain is not from removing rows. Rarity is a count over subjects, so counting
it inside the scope changes what a word is worth: `amount` on a payments
application distinguishes nothing, and `amount` inside the one area that is not
about amounts distinguishes a great deal. Filtering after the fact would keep
the suite-wide number and buy only the smaller half.

Both halves of that fraction have to be recounted, not just the population. The
first implementation scoped the denominator and kept the suite-wide holder
counts, and on a scope of one subject every word scored zero and the answer came
back empty — a bug that a test with two identical surfaces and a start point
caught, and that a test on a large corpus would have hidden, because there the
arithmetic is merely wrong rather than degenerate.

**A start point naming somewhere the subject is not returned it at no rank on
every one of those six hundred questions.** That is the property worth having
and the reason the scope prints in the header with its size: a wrong start point
fails visibly and emptily rather than promoting a confident wrong answer. A
start point that names nowhere at all scopes nothing, says which of its words
matched no place, and leaves the answer identical to the unscoped one — so the
cost of guessing wrong is a header, never a hit.
