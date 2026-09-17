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
Searched 128 of 4,705 subject(s), those produced by a file connected to `app/dispatch/page.tsx` — 1 file(s) named, 41 connected to them along the imports and against them. Rarity is counted inside that scope, so a word common to this area is worth nothing here even when the suite at large barely says it.
Read: id, example, names, text, components, createdBy, files, roles, tokens. Not read: regions (no execution journal was read).
…
```

Say it as wide as you actually know:

| you say | you get |
|---|---|
| `app/dispatch/page.tsx` | that file as the way in |
| `app/dispatch/*` | the files of that folder — the layout beside the page |
| `app/dispatch/` | everything underneath, however deep |

Say nothing about depth and you mean any depth, so the folder on its own is the
wider of the two, and the trailing `*` is the one that stops. Those three are
the whole vocabulary: a `*` anywhere but the last segment is a pattern, and a
pattern is not a path.

Say the parent along with the name, because a file name is not unique. Somewhere
there is a `Provider.tsx` loaded by every screen you have, and `Provider.tsx` on
its own cannot tell you which one you meant.

### Ask it from the checkout

A path is a fact about the source tree, so the source tree is what answers it.
Ask from a checkout of the repository the run was made in and the path is
resolved against the files that are actually there — not against the files the
run recorded, which are the files it was *seen in* and answer this wrongly in
both directions: every file the run never rendered would read as missing, and a
path a build wrote down would read as present long after the file was deleted.

The directory you ask in is the repository. Ask somewhere with no source beside
you and a start point is refused rather than approximated, and the answer says
which of the two happened.

The absolute path your editor hands you is the same question asked from the
root: under the repository it is that file, and outside the repository there is
nothing there.

### The path is the entrance, not the room

What you name is the way in. The imports decide the rest: a file is in the scope
when it is connected to one of your entry points — reached along the imports, or
reaching one against them, at any depth — and a subject is in the scope when a
file in the scope was seen producing it.

That is why naming one file still hands you an area. A checkout page is one file
and forty neighbours: the hook it calls, the component three imports down that
draws the badge, the layout above it that exists because the page does. Naming
the page means the neighbourhood, and you should not have to list it.

The walk is never shortened to save time, because a cut-off drops a file that is
genuinely connected and you would never see it go. Where the scan could not read
some file's own imports, the answer counts those files and says so: what lies
behind them is not enumerated, so the scope is not a proof about what it left
out.

### It is a boundary, not a preference

What you are looking for may be approximate — you half remember the badge, and
the ranking is built to reward a near miss. Where to look is the opposite kind of
thing. It is a coordinate you already have, so it is read exactly:

- Segments are compared whole and literally. `page` is not `pages`, and
  `Activity.ts` is not `Activity.tsx`.
- **A path exists or it does not, and that is the whole test.** `Badge.tsx`
  does not name the file under `apps/web` — it names a file at the root, and
  where no file is at the root, nothing is there and the answer is not found.
  Not *found under apps/web*, and not *two candidates, pick one*: handing back
  candidates is the same fragment rule wearing a politer face. Say
  `apps/web/Badge.tsx` or say `apps/web/`.
- **Nothing is looked for inside a path.** No matching tail, no run of segments
  found somewhere in the middle, no case folding, and no reading one path as
  another because one ends with the other.
- **A name is not a place.** Never a component, never an id, and never what a
  subject shows on screen. A button labelled *Dispatch* on the account screen is
  the thing you are looking for wearing the clothes of the place to look, and a
  start point that read visible text would hand it to you first.
- **A space is a character in a name**, and so is a backslash. One path is one
  string, spaces and all, and several paths are said as several strings.
- **A start point that names nothing is refused**, and nothing is searched. No
  answer is ever given from outside it: falling back to the rest of the suite
  would answer a question you did not ask, out of the files you ruled out — and
  would do it while printing a confident top hit.

Several paths are several entry points, and they are taken together rather than
intersected: two areas of an application have very nearly no files in common, so
keeping only what both hold would answer nothing exactly where you were most
specific. The CLI takes one `--from`; over MCP `from` also takes a list, as in
`variance_locate {query: "the contract warning", from: ["app/dispatch/", "src/shared/"]}`.

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
