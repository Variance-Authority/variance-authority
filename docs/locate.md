# Find the subject you mean

**This is how you search a suite.** You know which thing you want to look at.
You do not know what it is called.

Every tool that narrows to one subject takes an id —
[`variance_composition`](composition.md), [`variance_describe`,
`explain-verdict`, `trace-component`](agent-questions.md). On a suite of fifteen
that costs nothing, because the summary printed all fifteen ids and you read
them. Once the ids stop fitting in a summary you read, what you hold instead is
a description: *the footer with the filter chips*, *the toggle that marks a todo
done*, *the thing that uses the accent token*.

This page is the whole of search: what you need for it to work, how to ask, and
how to read what comes back. It finds subjects and hands you ids. It does not
grep your source, and it is not a code search tool.

## What you need

**Nothing you have to switch on.** Search rides on `variance run`. Any run whose
collector captured a full reading — markup, the CSS that applied, and the
component boundaries React's owner chain produced — writes the record that
search reads, and every later question is asked against the report that run
left behind.

Which words you can search in is decided by which readings that run took, and
the answer always tells you which it had:

| you get these words | when the run took |
|---|---|
| ids, components, creators, the example | any composing run — always there |
| accessible names, visible text, roles | a semantic snapshot |
| the regions a subject entered | an [execution journal](journeys.md) |
| declaring files | a [source index](source-index.md) |
| custom properties | the cascade the boundaries resolved through |

**Search is absent, and says so, on three kinds of run:** a raster-only capture,
which is an image with no markup behind it; a run under ephemeral retention; and
a suite built on something other than React, where there are no boundaries to
read. Absent is not empty — see [three answers that look
alike](#three-answers-that-look-alike).

## Ask it

Hand the description over as it stands:

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
page/todos--empty · 17 boundaries · example of TodoApp
  where: group `Filters` · src/todo/TodoFooter.tsx:41 · within Todos › Footer
  footer: components `TodoFooter`; createdBy `TodoFooter`
  chips: components `Chip`
…
ds/chip--group · 4 boundaries · example of Stack
  where: group `Chips` · src/ds/ChipGroup.tsx:12
  chips: id `ds/chip--group`; components `Chip`

next: variance_composition {subject: "page/footer--counts"} · variance_describe {subject: "page/footer--counts"}
```

Over MCP the same question is `variance_locate {query: "footer chips"}`.

**`where:` is the place behind the id.** An id is where the other tools start;
it is not where your question ends. The same run that wrote the words down
wrote where each of them was on the screen, so every hit carries the thing on
that surface saying your words, the file and line it is declared at, and what
it sits in. You asked *where does this live* and the answer is a file — no
second call to find that out.

**You get a file from a production build too.** The line an element sits on
comes from the JSX-source plugin and a build strips it, so on a built Storybook
no landmark carries one. What survives is the component that owns the thing, and
the run knows which files declare it — so the place reads `in \`CarrierPicker\` ·
src/dispatch/CarrierPicker.tsx` instead of a file and a line. That is a source
to open rather than a coordinate, and the answer prints it as one. With no
source index read, you get the component name alone, which is still somewhere to
start.

When your phrase names the thing *and* what it sits in — *the Pickup window on
the dispatch drawer* — the place is the enclosed one. The drawer can outscore
what is on it, being the rarer words, so nothing in the ranking reaches the
answer; but both were found and one holds the other, which is your phrase
saying it named a path. Containment decides it, and containment is recorded
whether or not the run resolved layout.

**One subject answers to several words**, because the run read it under several
vocabularies to compare it and kept all of them: `checkbox` finds the toggle
because the run recorded its role, `--va-space-2` finds every subject that
resolved through the token, and a filename finds whatever that file declares.
None of it was written to be searched. So the word you happen to be holding is
often one the suite already holds — and when it is not, the answer says which
fields it looked in rather than guessing at a synonym. That record is the
[lexicon](lexicon.md), and it is where the how and the why are.

## Say where to look

On a suite of a few hundred, a description is enough. On a few thousand it is
not — and the missing word is usually not a better description of the thing but
the place you are standing.

### Say the file, and say its parent

Most of the time you have one: it is open in front of you, or the ticket names
it, or a stack trace just handed it to you. Paste it.

```bash
variance ask locate --query "the contract warning" --from "app/dispatch/page.tsx"
```

```text
3 of 4,705 subject(s) match `the contract warning`.
Searched 128 of 4,705 subject(s), those recorded in a file at `app/dispatch/`. Rarity is counted inside that scope, so a word common to this area is worth nothing here even when the suite at large barely says it.
Read: id, example, names, text, components, createdBy, files, roles, tokens. Not read: regions (no execution journal was read).
…
```

Say it as wide as you actually know:

| you say | you get |
|---|---|
| `app/dispatch/page.tsx` | that file, and only what it shows |
| `app/dispatch/*` | the files of that folder — the layout beside the page |
| `app/dispatch/` | everything underneath, however deep |
| `app/*/page.tsx` | one segment you would rather not name |

Say nothing about depth and you mean any depth, so the folder on its own is the
wider of the two. Paste the absolute path your editor gives you or type the tail
you remember — both find the same file, and so does either against a run that
recorded its paths from somewhere else on disk.

Say the parent along with the name, because a file name is not unique. Somewhere
there is a `Provider.tsx` loaded by every screen you have, and `Provider.tsx` on
its own cannot tell you which one you meant.

### It is a boundary, not a preference

What you are looking for may be approximate — you half remember the badge, and
the ranking is built to reward a near miss. Where to look is the opposite kind of
thing. It is a coordinate you already have, so it is read exactly:

- Segments are compared whole and literally. `page` is not `pages`, and
  `Activity.ts` is not `Activity.tsx`.
- Only the files each subject was seen in can answer it — never a component,
  never an id, and never what a subject shows on screen. A button labelled
  *Dispatch* on the account screen is the thing you are looking for wearing the
  clothes of the place to look, and a start point that read visible text would
  hand it to you first.
- A bare word is refused rather than reinterpreted. Nothing about `dispatch`
  says whether it is a folder, a component, a product area or a label, so you
  are asked for the path instead of being guessed at.
- **No answer is ever given from outside it.** A path no file sits at searches
  nothing and returns nothing. Falling back to the rest of the suite would
  answer a question you did not ask, out of the files you ruled out — and would
  do it while printing a confident top hit.

Every path counts. `--from "app/dispatch/ src/shared/"` keeps only subjects seen
in a file at both, because two paths in a start point are you narrowing on
purpose rather than describing more fully.

**It does two things, and the second is the one worth having.** Removing
subjects is the obvious half. The other is that rarity is a count over subjects,
so counting it inside the scope changes what your words are worth: a word every
screen in the application says is worth nothing, and a word every screen *in
this area* says is worth nothing here. Those are different statements, and
inside an area the second is the useful one.

A start point narrows a relation question the same way, where it is removing
surfaces before any of them is read:

```bash
variance ask locate --query "the warning under the Carrier field" --from "app/dispatch/"
```

Over MCP both are `variance_locate {query, from}`.

## Ask where something sits

Half the descriptions you hold are one step longer than *which subject*: **the
warning underneath the Carrier field on the dispatch drawer** names two things
and the relation between them. No count of matched words answers it — a subject
holding both words holds them whatever their order on the screen, and the
surface where the warning sits *above* the field matches just as well.

Put the relation in the query and it is read off the arrangement instead:

```bash
variance ask locate --query "the warning under the Carrier field on the dispatch drawer"
```

```text
1 surface(s) of 3 put `warning` beneath `carrier field dispatch drawer`, 2 read in full.

shipping/dispatch-drawer--carrier-unverified · example of DispatchDrawer
  anchor: combobox `Carrier` · src/dispatch/CarrierPicker.tsx:64
  beneath, 4px away: status “No active contract on file” · src/dispatch/CarrierPicker.tsx:78 (nothing there says `warning` — matched on place)
  also beneath: group `Pickup window` · src/dispatch/PickupWindow.tsx:22 · status “Outside depot hours” · src/dispatch/PickupWindow.tsx:40
  within: Dispatch shipment
```

`under`, `above`, `inside`, `left of`, `right of` and `beside` are the words that
switch it. Everything in front of one names what you are looking for; everything
behind it names what it sits by, and the surface it sits on.

**Here the place is the whole answer**, not a line beside the id. Order is still
orientation and a wrong top hit costs you one more call; what the relation buys
is that the surface where the warning sits *above* the field never reaches you
at all.

Three things in that answer are worth reading before you act on it:

- **`matched on place`.** You said `warning`; the screen says `role=status` and a
  sentence about a contract. No table joins those — a table is declared rather
  than derived and rots with the first refactor, and you already know what a
  warning looks like. So the answer shows what is actually in the relation and
  says it matched on where it is, not on what it is called. When your word *is*
  on the screen it says so instead.
- **`also beneath`.** Everything else standing in the same relation, nearest
  first. The one you meant is sometimes the second.
- **`4px away`.** Measured between the rectangles the run resolved. Absent when
  the run resolved no layout — and a spatial question against such a run is
  refused rather than answered from document order. `inside` still answers,
  because containment needs no rectangles.

## Read a hit before you trust it

**Each hit prints the field the words matched on**, term by term. Above, the
first hit matched `footer` on its id, its example, its components and its
creator, and `chips` on a component — four independent readings agreeing. The
last matched `chips` on a component alone. That is the difference between a
subject named for the thing and a subject that merely contains one, and you can
see which one you have before you open it.

The order is orientation, not evidence: nothing in the answer carries a verdict,
a pixel count or a file to open, only ids and the tools that take them. Read the
field you matched on, then narrow.

## Three answers that look alike

The header separates them before the hits, per field:

- **Read, and nothing matched.** The names exist; your word is not among them.
  Ask again in the suite's vocabulary — a term no subject holds is named as
  such, beside the accessible names the run did record, so the answer tells you
  what to try.
- **Not read.** No execution journal means no `regions`; no snapshot means no
  `names`, `text` or `roles`; no [source index](source-index.md) means no `files`. Nothing was
  searched, so nothing could match. Supply the reading and ask again.
- **Read, and genuinely empty.** A production build with the owner links
  stripped has an empty `createdBy` on every subject. It was read. There is
  nothing there.

A subject whose values were capped says how many it lost, so a short answer is
never mistaken for an exhaustive one.

## Then narrow

An id is the door into everything else. `variance_composition {subject}` prints
what the subject is made of; `variance_describe {subject}` prints what was
observed; `explain-verdict` says why it passed or failed. The answer names two
of them under `next:` with the id already filled in.

On a [tier](composition.md) that composed nothing there is no census, so both
`locate` and `composition` are absent and say so, rather than being present and
matching nothing.
