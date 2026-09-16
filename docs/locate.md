# Find the subject you mean

You know which thing you want to look at. You do not know what it is called.

Every tool that narrows to one subject takes an id —
[`variance_composition`](composition.md), [`variance_describe`,
`explain-verdict`, `trace-component`](agent-questions.md). On a suite of fifteen
that costs nothing, because the summary printed all fifteen ids and you read
them. Once the ids stop fitting in a summary you read, what you hold instead is
a description: *the footer with the filter chips*, *the toggle that marks a todo
done*, *the thing that uses the accent token*.

Hand the description over as it stands:

```bash
variance ask locate --query "footer chips"
```

```text
7 of 15 subject(s) match `footer chips`.
Read: id, example, names, text, components, createdBy, files, roles, tokens. Not read: regions (no execution journal was read).

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

Over MCP the same question is `variance_locate {query: "footer chips"}`.

**One subject answers to several words**, because the run read it under several
vocabularies to compare it and kept all of them: `checkbox` finds the toggle
because the run recorded its role, `--va-space-2` finds every subject that
resolved through the token, and a filename finds whatever that file declares.
None of it was written to be searched. So the word you happen to be holding is
often one the suite already holds — and when it is not, the answer says which
fields it looked in rather than guessing at a synonym. That record is the
[lexicon](lexicon.md), and it is where the how and the why are.

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
  `names`, `text` or `roles`; no source index means no `files`. Nothing was
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

## When no run has happened

You can ask this before you have run anything on the branch. The names outlive
the run that read them, in the
[suite index](lexicon.md#where-it-is-kept) a run leaves behind, and
[sharing an evaluation](sharing.md) is how that file reaches the checkout you
are standing in.
