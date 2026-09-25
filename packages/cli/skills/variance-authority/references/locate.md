# Locate a subject you can only describe

Every narrow question takes a subject id, and you have a description. `locate`
goes the other way. It searches the names the run recorded while comparing
subjects: ids, examples, accessible names, visible text, components, creators,
declaring files, roles, custom properties, and the regions a journey covered. It
does not read the repository and it is not code search; for a name in the
source, ask `search` in the [workspace API](workspace-api.md).

Hits are ranked by how many of your words matched and how rare each word is.
Past a trailing plural there is no stemming. The rule for expanding a query is
in `SKILL.md` under *Matching is lexical*.

## Ask in a different kind of name

Each row is a field. The header of every answer says for which subjects the run
took that reading.

| kind | example query |
|---|---|
| what the screen says | `Sign in`, `Mark as done` |
| what the component is likely called | `Credential`, `Login`, `Session` |
| where it is likely written | `session`, `entry`, `auth/` |
| what it is, structurally | `checkbox`, `dialog`, `alert` |
| what styles it | `--va-space-2` |

An unmatched term is named as such in the answer, with the accessible names the
run did record printed beside it. Build the next query out of those.

## Hand the description over as words

No word in `--query` is read as syntax, so a product that says *Under review*,
*Show more* or *Inside sales* is searched for those words:

```bash
variance ask locate --query "footer filter chips"
```

Every answer opens with what was searched and what was not, then the hits, then
where to take the id:

```
1 of 3 subject(s) match `badge`.
Read: id, example, names, text, components, createdBy, files, roles, tokens.
Not read: regions (no execution journal was read).

badge/standalone · 1 boundary · example of Badge
  badge: id `badge/standalone`; example `Badge`; components `Badge`

next: variance_composition {subject: "badge/standalone"} · variance_describe {subject: "badge/standalone"}
```

## Scope a large suite with a start point

On a few hundred subjects the description is enough. On a few thousand, the
missing word is the place, not a better adjective. `--from` and `--to` work as
`SKILL.md` describes under *Say where you are standing*. They also change what
your words are worth: rarity is counted inside the scope, so a word common to
that area is worth nothing there.

```bash
variance ask locate --query "contract warning" --from "app/dispatch/page.tsx"
```

## Name the arrangement when the description is a relation

*The warning under the Carrier field, on the dispatch drawer* names two things
and how they sit. Counting matched words cannot answer it, because the surface
where the warning sits *above* the field has the same words. Name the three
parts separately; the relation is the name of the flag:

```bash
variance ask locate --query "warning" --under "Carrier" --on "dispatch drawer"
```

`--under`, `--above`, `--inside`, `--beside`, `--left-of` and `--right-of` take
the anchor, the thing it sits by. `--on` takes the surface. Give it: without it
the anchor has to pick the surface as well. One relation per question; two is
refused.

**`--inside` is the only relation a run without layout can answer.** The other
five are decided from the rectangles the run resolved. A run that resolved no
layout refuses them rather than falling back to document order, and says so:
*"This run did not resolve layout, so no landmark carries a rectangle and
nothing here knows what sits beneath what."* Containment needs no rectangle.
Check the run's layout before you use the other five.

On a relation answer, read three things before acting:

- `matched on place` — nothing on the screen says your word; the landmark was
  found by where it is, not by what it is called. When your word is on it, the
  answer says so instead.
- `also beneath` (and the other relations) — everything else in that relation,
  nearest first. The one you meant is sometimes the second.
- `4px away` — measured between resolved rectangles. Absent when the run
  resolved no layout.

## Every hit is already a place

`where:` names the thing on that surface that says your words, the file and line
it is declared at, and what encloses it. A production build strips the line, so
the place reads `in CarrierPicker · src/dispatch/CarrierPicker.tsx`: a source to
open rather than a coordinate. Do not spend a second question asking where
something lives.

## Read the header before reading an empty answer

Three states look alike, and the header separates them per field:

- **Read, and nothing matched.** The names exist and your word is not among
  them. Ask again in another kind of name, from the table above.
- **Not read.** No journal means no regions; no snapshot means no names, text or
  roles; no source index means no files. Nothing was searched.
- **Read, and empty.** A build with owner links stripped has an empty
  `createdBy` everywhere.

Search is absent altogether, and says so, on a raster-only capture, a run under
ephemeral retention, and a suite that is not React.

The order of hits is orientation, not evidence: no hit has a verdict or a pixel
count. Read the field each term matched on, narrow, then take the id to
`composition`, `describe` or `explain-verdict`.
