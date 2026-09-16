# The bag could not say which thing was under the other

The lexicon answers *which subject do I mean*. Half the descriptions an agent
actually holds are one step longer than that:

> Change the warning underneath the Assignee field on the create issue dialog

Three things and one relation. A bag of words holds `assignee` and holds the
warning's sentence and cannot hold the fact that the second sits under the
first — so it ranks by how many words matched, and a surface where the warning
sits *above* the field matches every bit as well. Adding fields does not fix
that. There is no word to add, because the missing fact is not a word.

## The arrangement was already in the walk

`valuesOf` walks the whole snapshot tree to fill the bags. Everything the
question needs is in hand at that moment and thrown away one line later: where
each node was, what enclosed it, what it said. So the fix was a representation
change and not an instrument. The same walk now also emits a landmark per node
that earns one, and because the words and the places come out of one pass over
one tree they cannot disagree about what was on the screen.

What earns a landmark: **a role, an accessible name, or words of its own.**
Nothing else. That one test does the whole job on trees nobody can enumerate —
higher-order component wrappers, context providers, minified class names — by
never recognising any of them. A control under four anonymous divs writes one
landmark, not five. `within` names the nearest enclosing *landmark* rather than
the nearest node, so containment survives any depth of scaffolding.

Two smaller decisions cost a test each. Own text is direct `#text` children
only, so a dialog does not inherit its button's sentence and answer for it. And
the first version returned early on `#text` nodes to skip making landmarks of
them — which silently emptied the `text` bag the lexicon has always written,
because those nodes are exactly where that bag comes from. The landmark test
caught it in the same run it was introduced.

## The screen does not say `warning`

The first end-to-end question returned nothing at all, and the reason was not
plumbing. A person asks for **the warning**; the DOM says `role="status"` and a
sentence about a contract. The word `warning` is on no surface, so gating the
search on it discards the right answer everywhere.

A synonym table is the obvious fix and is foreclosed — ADR-0057 rules out
declared vocabulary, on the ground that it rots with the first refactor. The
clause that decided it is the one about who is asking: *the agent asking is the
model that would have written them.* It does not need `warning → status`. It
needs to be shown what is there.

So the target's words narrow and do not gate. Only the anchor gates — a surface
that never says `assignee` cannot be the surface meant, while a surface that
never says `warning` is most surfaces with a warning on them. When nothing in
the relation matched on words, the answer is *what is actually in that
relation*, flagged `matched on place`. The reader is told which of the two it
got, because the two are equally useful and only one of them is a match.

## The anchor phrase does two jobs and they fought

"the Carrier field on the dispatch drawer" chooses the surface and chooses the
landmark, deliberately unsplit, because splitting it needs a grammar. The test
then found the failure that design invites: the dialog is *named* for the
drawer, so the surface-naming half of the phrase won the landmark contest, and
nothing on the surface is beneath a dialog that contains all of it.

The relation breaks the tie, and it needs no grammar to do it. Each scoring
landmark is tried as the anchor and the first that has something standing in the
relation wins. A place has nothing beneath it because everything is inside it;
a field does. Which noun was the place never has to be decided.

## What it costs

Folded over Material UI's 4,705 recorded subjects — every capture the suite
wrote, not a sample:

```
subjects 4,705 · 3,827 carry landmarks · 11,599 landmarks · 0 elided
per subject: p50 1 · p90 6 · p99 12 · max 52   (the cap is 400)
728 KB of landmarks · 35 ms to fold all of it
```

The cap is eight times the largest subject in a 4,705-subject suite and thirty
times its 99th percentile, and that is a library's component tests rather than
an application's screens, so the headroom is the point rather than the number.
728 KB against a 36.5 MB report is 2%.

That suite renders under jsdom, which resolves no layout, so it prices the
structure and can say nothing about the rectangles. The half that needs them is
unmeasured, and a spatial question against such a run is refused rather than
answered from document order — which agrees with the screen often enough to be
dangerous and not often enough to be relied on. Containment answers anyway,
because `within` needs no rectangles.

## Then the measurement moved the design twice

Containment needs no rectangles, so the structure-only capture set could be
asked at once: four hundred questions built from the record itself — *the `X`
inside the `Y`* — against all 4,705 subjects. The first number out was 51 right
first, and it meant nothing, because the median question in that corpus is
answered identically by **36 other subjects**. A component library's captures
are a prop matrix. Only the 66 questions with a single holder can score a
reader at all, and that is the first thing a corpus has to be checked for.

On those 66, the misses were not spread. Sixteen of twenty-eight landed on the
**correct surface and the wrong thing on it** — and that was not a ranking
flaw. A phrase names the thing and what it sits in; the two tie on words; with
no rectangles document order broke the tie toward the container, which is never
what anybody means. Depth is the size that needs no layout. Preferring the
deeper of two tied landmarks took 38 right to 47 and that class of miss from 16
to 7.

The same question asked the way a person actually holds it — *the X Y*, no
relation word at all — found the second half of it. There the container does not
tie, it **wins**: two rare words against one. No tie-break is ever reached. But
both were found and one holds the other, which is the phrase saying it named a
path — what encloses is the place and what is enclosed is the thing. That rule
took the place right on 29 of 66 to 38, against a ceiling of the 53 whose
surface was right at all.

**Both fixes are containment, and containment was in the record from the first
walk.** Neither needed a rectangle, a threshold, or a word of grammar — and
neither would have been found without a corpus big enough to be ambiguous.

## Then the real application said what a cap costs

The other corpus — a product web app, a browser, layout resolved — priced the
half a component library cannot show. Every landmark on every subject carried a
rectangle. Four subjects carried four hundred landmarks each, which is the cap,
and between them they were losing 1,973 places. Their true sizes were roughly
1,179, 926, 836 and 632: the application's four biggest screens, the ones
somebody most needs orienting on, and what a cap cuts off a screen is its
bottom — where a warning underneath a field lives. The cap was a guess and a
suite falsified it. Twelve hundred, and the re-run elides nothing: 15,057
landmarks, exactly the 1,973 restored, the next percentile still at 231.

The same run answered the question the tests could only assert. `file`, `line`,
`handle` and `createdBy` are present on **none** of the 15,057 landmarks — a
production build strips the JSX source — and the owner chain is on all of them.
So the join closes completely: 39 distinct components, all 39 resolving through
a `declaredIn` of 395 rows and 26 KB. Every landmark ends at a file.

And the file is a bundle chunk, and all 39 names are one and two letters. The
mechanism is whole and the answer reads ``in `q` · assets/…``, which is not
orientation by any reading. Nothing downstream can repair it: the names and the
modules were destroyed before the run started. What the measurement bought is
the division — the join is not the missing half; a build that keeps its names
is, and that is a line in somebody's Vite config rather than a design.

## And the same rule was missing one branch over

With rectangles in hand, *beneath* could finally be asked of a real
application. Four hundred questions off its own record, 199 of them held by a
single surface: the surface right 180 times, the exact thing right 122, and
fifty-eight misses on the right surface.

Classifying them mattered more than counting them. Thirty-eight of the
fifty-eight returned something that genuinely **is** beneath the anchor asked
for — the question was one word short of deciding, which is what `also beneath`
is printed for, and the meant thing is in that list in seventeen of them.
Eighteen resolved a different anchor, and six of those eighteen chose a
landmark that *encloses* the one meant.

That six was the containment rule again, and this time it was not missing from
the design but from one branch of it: the relation path stopped at the first
anchor candidate that made the question answerable, so a container scoring
higher ended the search before the thing on it was tried. It now weighs every
candidate that answers and lets containment choose — the same three lines, in
the branch that did not have them. 122 to 128, that class of wrong anchor to
zero, and the containment corpus one question worse for it.

**Twice now the fix has been the record saying what encloses what**, and both
times the measurement found it rather than the design. A rule can be right and
still be installed in only one of the two places that need it.

## The six were real and the corpus is gone

Those four hundred questions were asked against a report in a working
directory that has since been cleared. 122, 128, six to zero: none of it can be
re-derived. It is recorded above as what was seen, and a reader cannot check
it, which is the difference between a measurement and an anecdote.

So the rule was measured again, against its own absence, on the two corpora
that persist. Take the three lines out, rebuild, ask the same questions, put
them back:

```
2019 app, beneath   63 → 63   unchanged
library, inside     21 → 20   one worse
```

Neutral on one, a question worse on the other. Its entire demonstrated benefit
is on the corpus that no longer exists. What survives as an argument is the
shape rather than the number: the miss class it was written for —
*the anchor chosen encloses the one meant* — is **zero** on both corpora that
can be re-measured, and was six on the one that had the shape. It is kept on
that argument, and the argument is weaker than a number. If a third corpus ever
shows the class at zero while the rule costs questions, it goes.

A real application also produced a miss class the library never could. Of
twenty-two wrong answers on the right surface, sixteen were the wrong anchor,
and fourteen of those sixteen resolved a landmark **saying the same words
somewhere else on the same screen**. Nothing structural about it: an app that
renders a row many times says the same sentence many times, and the question is
one word short of choosing between them. The meant place was under `also
beneath` in seventeen of the twenty-two.

## The division held, and the build was the missing half

Two sections up the finding was that the join closes and the answer still reads
``in `q` · assets/…``, and that what was missing is a build keeping its names.
A third corpus had one. Its Babel config leaves `@babel/preset-react` with
`development: true`, so the JSX-source transform survives into the built
Storybook — the transform every previous corpus stripped.

Same reader, same code, 6,264 landmarks across 165 subjects:

```
box          100%      component   100%      createdBy   65.6%
file & line  91.7%     files       231 distinct, all source
names        122 components, none minified
```

Against **0 of 15,057** with a file or line on the build that stripped it. The
rendered place stops being a bundle chunk and becomes a source file with the
line inside it — a coordinate somebody opens, not a name they go looking for.
`declaredIn` joined every component asked about, and the cap was never near:
the largest subject held 421 landmarks against 1,200, nothing elided anywhere.

**The build was the missing half, exactly as the division predicted.** Which is
the useful part: a measurement that could not fix the answer still said which
of two things to go and change, and it named the one outside this codebase.
