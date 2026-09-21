# Find the subject you mean

You know which thing you want to look at. You do not know what it is called.

This is the subject route through [orientation](orientation.md). It searches
what a completed run observed. If the thing you need is an exported name in the
current checkout, use [the source how-to](agent-workspace-api.md) instead.

Each comparison is keyed by a **subject**: one named UI state you asked for and
can ask for again, under an id you choose, such as `cart/empty`.

This page is search. Read it when you can describe a subject but cannot name it.
Every tool that narrows to one subject takes its id, and on a suite of fifteen
that costs nothing, because the summary printed all fifteen ids. Once the ids
stop fitting in a summary you read end to end, what you have instead is a
description: *the footer with the filter chips*, *the toggle that marks a todo
done*, *the thing that uses the accent token*. Search turns that description
into ids. It does not grep your source, and it is not a code search tool.

New here? Start with [your first run](start.md). The CLI is a devDependency, so
every invocation below runs through `npx`:

```bash
npm install --save-dev @variance-authority/cli
```

## Three more words this page uses

- A **boundary** is one React component enclosing an element on the screen, read
  off React's owner chain while the page was captured. Boundaries are where the
  searchable words come from, which is why a suite built on something other than
  React has none of them.
- A subject's **example** is the component that subject is the clearest single
  rendering of — the shallowest boundary that is not layout structure.
  `createdBy` is the component that mounted a boundary, which is usually one
  step further out than the component enclosing it.
- A **surface** is one captured screen: a subject's reading, together with every
  element the run recorded on it and where each one sits.

## What you need

**One run, with nothing extra switched on.** `npx variance run` renders your
subjects and compares them against their baselines; a run that read the markup,
the CSS that applied and the component boundaries writes the record search
reads. Every question below is asked against the report that run left behind —
there is no index to build and no service to start.

Which words you can search in is decided by which readings that run took. Every
answer lists the fields it read and the fields it did not:

| you get these words | when the run took |
|---|---|
| ids, components, creators, the example | any run that read boundaries — always there |
| accessible names, visible text, roles | a reading of the accessibility tree and the text on the page |
| the regions a subject covered | an [execution journal](journeys.md) — a record of which source regions each test ran through |
| declaring files | a [source index](source-index.md) — the map from a component to the files that declare it |
| custom properties | the CSS cascade those boundaries resolved through |

**Search is absent, and says so, on three kinds of run:** a raster-only capture,
which is an image with no markup behind it; a run under ephemeral retention,
which renders the baseline inside the run and keeps nothing once the run ends;
and a suite built on something other than React, which leaves no boundaries to
read and so no words beyond the ids you chose. Absent is not empty — see [three
answers that look alike](#three-answers-that-look-alike).

## Ask it

Hand the description over as it stands:

```bash
npx variance ask locate --query "footer chips"
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
wrote where each of them was on the screen, so every hit shows the element on
that surface saying your words, the file and line it is declared at, and what it
sits in. A place reads as the element's role, its name, then where it was
written: `group \`Filters\` · src/todo/TodoFooter.tsx:41`. You asked *where does
this live* and the answer is a file — no second call to find that out.

**You get a file from a production build too.** The line an element sits on
comes from the JSX-source plugin and a build strips it, so on a built Storybook
no recorded element has one. What survives is the component that owns the
thing, and the run knows which files declare it — so the place reads
`in \`CarrierPicker\` · src/dispatch/CarrierPicker.tsx` instead of a file and a
line. That is a source
to open rather than a coordinate, and the answer prints it as one. With no
source index read, you get the component name alone, which is still somewhere to
start.

When your phrase names the thing *and* what it sits in — *the Pickup window on
the dispatch drawer* — the place is the enclosed one. The drawer can outscore
what is on it, being the rarer words, so nothing in the ranking gives you the
answer; but both were found and one contains the other, which is your phrase
saying it named a path. Containment decides it, and containment is recorded
whether or not the run resolved layout.

**One subject answers to several words**, because the run read it under several
vocabularies to compare it and kept all of them: `checkbox` finds the toggle
because the run recorded its role, `--va-space-2` finds every subject that
resolved through the token, and a filename finds whatever that file declares.
So the word you happen to use is often one the suite already knows; when it is
not, the answer says which fields it looked in rather than guessing at a
synonym. That record is the [lexicon](lexicon.md) — the names the run wrote
down, field by field — and that page has the how and the why.

## Ask in more than one vocabulary

The word you arrived with is often not a word the suite says. You are looking for
the sign-in screen and you call it `auth`; the screen says *Sign in*, the
component is `CredentialGate`, and the file is `session/entry.tsx`. Nothing the
run wrote down is your word, so the answer is the fields it searched and no hits
— correct, and no help. Rewording it changes nothing: `the authentication
flow` is three more words the suite does not say either, and a question is
matched on its words.

Nothing here expands your word for you. There is no thesaurus, no stemmer beyond
a trailing plural, and no model — the match is your words against the names the
run recorded, ranked by how many matched and how rare each one is. What a word means
is your half of the question, and it stays yours: you have the ticket and the
checkout, and you already know which names this codebase is in the habit of
writing.

So spend a second query instead of a better first one. Ask in a different **kind**
of name, not a longer description of the same thing:

| kind of name | what to ask |
|---|---|
| what the screen says | `Sign in`, `Continue`, `Mark as done` — the visible text and the accessible name |
| what it is likely called | `Credential`, `Login`, `Session` — a component name, in this repository's habits |
| where it is likely written | `session`, `entry`, `auth/` — a file or a folder |
| what it is, structurally | `checkbox`, `dialog`, `alert` — the ARIA role |
| what it is styled by | `--va-space-2` — a custom property the cascade resolved |

Each row is a field, so each is a real way in — for the subjects whose run took
that reading. Which ones those are is printed above every answer, and a row read
for nothing is a row not worth trying: see [three answers that look
alike](#three-answers-that-look-alike).

A question costs one call and prints what it searched, so working down the rows
is how you find which vocabulary this suite is written in, and the row that hits
tells you what to ask for everything after it. When a term matches nothing, the
answer names it as unmatched and prints beside it the accessible names the run
did record. Build the next query out of those.

## Say where to look

On a suite of a few hundred, a description is enough. On a few thousand it is
not — and the missing word is usually not a better description of the thing but
the place you are standing.

### Say the file, and say its parent

Most of the time you have one: it is open in front of you, or the ticket names
it, or a stack trace just handed it to you. Paste it.

```bash
npx variance ask locate --query "the contract warning" --from "app/dispatch/page.tsx"
```

```text
3 of 4,705 subject(s) match `the contract warning`.
Searched 128 of 4,705 subject(s), those produced by a file reachable from `app/dispatch/page.tsx` — 1 file(s) named, 41 reachable from them along the imports. Rarity is counted inside that scope, so a word common to this area is worth nothing here even when the suite at large barely says it.
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

### Naming one file names its imports

What you name is the way in. The imports decide the rest: a file is in the scope
when it is reachable from one of your entry points, along the imports, at any
depth — and a subject is in the scope when a file in the scope was seen
producing it.

That is why naming one file still hands you an area. A checkout page is one file
and forty neighbours: the hook it calls, the component three imports down that
draws the badge, the formatter that component depends on. Naming the page means
the neighbourhood, and you should not have to list it.

The walk runs one way. What your entry point imports is in the scope; what
imports your entry point is not, or naming a single button would name every
screen that uses it. You still see those screens when they belong: a subject is
in the scope because a file in the scope was seen producing it, so naming the
button hands you every subject the run recorded it in.

The walk runs to any depth; nothing is cut off to save time. Where the scan
could not read some file's own imports, the answer counts those files and says
so: what lies behind them is not enumerated, so the scope is not a proof about
what it left out.

### Say `--to` for the other way

`--from` answers what your file rests on. Half the time the question is the
other one: you are standing in `components/user-select.tsx` and what you want is
the screens that show it. Name it as `--to` and the walk runs against the
imports.

```bash
npx variance ask locate --query "settings page" --to "components/user-select.tsx"
```

A file is in that scope when it *reaches* what you named, at any depth — the
page that imports the panel that imports the select. The path is read by the
same rules and the three widths mean the same things; only the direction
changes, and the header says which one it went: *reachable from* for one,
*reaching* for the other.

Say both and you have named two places, not one crossing. Each is answered in
its own direction and the two are taken together, for the reason two `--from`
paths are: what a page rests on and what rests on a helper have very nearly no
file in common, so crossing them would answer nothing. Saying one path both ways
is how you ask for everything above and everything below it — available, and
never given to you by accident.

### A start point is read exactly

What you are looking for may be approximate — you half remember the badge, and
the ranking is built to reward a near miss. Where to look is the opposite kind of
thing. It is a coordinate you already have, so it is matched literally:

- Segments are compared whole and literally. `page` is not `pages`, and
  `Activity.ts` is not `Activity.tsx`.
- **A path exists or it does not, and that is the whole test.** `Badge.tsx`
  does not name the file under `apps/web` — it names a file at the root, and
  where no file is at the root, nothing is there and the answer is not found.
  Not *found under apps/web*, and not *two candidates, pick one*. Say
  `apps/web/Badge.tsx` or say `apps/web/`.
- **Nothing is looked for inside a path.** No matching tail, no run of segments
  found somewhere in the middle, no case folding, and no reading one path as
  another because one ends with the other.
- **A name is not a place.** Never a component, never an id, and never what a
  subject shows on screen. A button labelled *Dispatch* on the account screen is
  the thing you are looking for, and it looks like the place to look for it — a
  start point that read visible text would hand it to you first.
- **A space is a character in a name**, and so is a backslash. One path is one
  string, spaces and all, and several paths are said as several strings.
- **A start point that names nothing is refused**, and nothing is searched. No
  answer is ever given from outside it: falling back to the rest of the suite
  would answer a question you did not ask, out of the files you ruled out — and
  would do it while printing a confident top hit.

Several paths are several entry points, and they are taken together rather than
intersected: two areas of an application have very nearly no files in common, so
keeping only what appears in both would answer nothing exactly where you were
most specific. The CLI takes one `--from` and one `--to`; over MCP each also
takes a list, as in `variance_locate {query: "the contract warning", from:
["app/dispatch/", "src/shared/"]}`.

**A start point also changes what your words are worth.** Removing subjects is
one half. The other is that rarity is a count over subjects, so counting it
inside the scope changes the ranking: a word every screen in the application
says is worth nothing, and a word every screen *in this area* says is worth
nothing here. Those are different statements, and inside an area the second is
the useful one.

A start point narrows a relation question the same way, where it is removing
surfaces before any of them is read:

```bash
npx variance ask locate --query "warning" --under "Carrier field" --from "app/dispatch/"
```

Over MCP all of it is one call: `variance_locate {query, under, on, from, to}`.

## Ask where something sits

Half your descriptions are one step longer than *which subject*: the warning
underneath the Carrier field, on the dispatch drawer. That names two things and
the relation between them. No count of matched words answers it — a subject
saying both words says them whatever their order on the screen, and the surface
where the warning sits *above* the field matches equally well.

Name each of the three separately and the arrangement is read instead:

```bash
npx variance ask locate --query "warning" --under "Carrier" --on "dispatch drawer"
```

```text
1 surface(s) of 3 put `warning` beneath `carrier` on `dispatch drawer`, 2 read in full.

shipping/dispatch-drawer--carrier-unverified · example of DispatchDrawer
  anchor: combobox `Carrier` · src/dispatch/CarrierPicker.tsx:64
  beneath, 4px away: status “No active contract on file” · src/dispatch/CarrierPicker.tsx:78 (nothing there says `warning` — matched on place)
  also beneath: group `Pickup window` · src/dispatch/PickupWindow.tsx:22 · status “Outside depot hours” · src/dispatch/PickupWindow.tsx:40
  within: Dispatch shipment
```

**The relation is the name of the flag**, and there are six: `--under`,
`--above`, `--inside`, `--beside`, `--left-of` and `--right-of`. What you pass to
one is the anchor — what the thing sits by. `--query` stays what you are looking
for, and `--on` is the surface the two are on.

Nothing in `--query` is ever read as syntax. Your product is free to say *Under
review*, *Show more* and *Inside sales*, and asking for those words gets you
those words. Say one relation per question — two is a question with two answers,
and it is refused rather than resolved.

`--on` is optional and worth saying. Without it the anchor has to pick the
surface as well as the element on it, and the drawer and the field on it both
answer to the drawer's name: the answer then comes out of whichever reading the
relation makes answerable, which is a derivation rather than something you
said. With it, you have said which screen, and only the anchor is
looked for on it.

**Here the place is the whole answer**, not a line beside the id. Order is still
orientation and a wrong top hit costs you one more call; what the relation buys
is that you never see the surface where the warning sits *above* the field at
all.

Three things in that answer are worth reading before you act on it:

- **`matched on place`.** You said `warning`; the screen says `role=status` and a
  sentence about a contract. Nothing maps one onto the other, so the answer
  shows what is actually in the relation and says it matched on where it is, not
  on what it is called. When your word *is* on the screen it says so instead.
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

The order is orientation, not evidence: nothing in the answer says whether a
subject passed or failed, and none of it includes a pixel count or a diff to
open — only ids and the tools that take them. Read the field you matched on,
then narrow.

## Three answers that look alike

The header separates them before the hits, per field:

- **Read, and nothing matched.** The names exist; your word is not among them.
  Ask again in the suite's vocabulary — a term no subject uses is named as
  such, beside the accessible names the run did record, so the answer tells you
  what to try.
- **Not read.** No execution journal means no `regions`; no reading of the
  accessibility tree means no `names`, `text` or `roles`; no [source
  index](source-index.md) means no `files`. Nothing was searched, so nothing
  could match. Take the missing reading on the next run and ask again.
- **Read, and genuinely empty.** A production build with the owner links
  stripped has an empty `createdBy` on every subject. It was read. There is
  nothing there.

A subject whose values were capped says how many it lost.

## Then narrow

An id is the way into everything else. Over MCP,
[`variance_composition {subject}`](composition.md) prints what the subject is
made of, [`variance_describe {subject}`](agent-questions.md) prints what was
observed, and [`variance_explain_verdict {subject}`](agent-questions.md) says
why a subject was not compared. The answer names two of them under `next:` with
the id already filled in.

A run that read no component boundaries — a raster-only capture, or a suite that
is not React — has nothing to search and nothing to compose, so `locate` and
`composition` are both absent and say so, rather than being present and matching
nothing.
