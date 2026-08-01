# Context — the paper trail

This directory is the project's memory. It exists so that any contributor (human
or agent) can reconstruct *why* the code looks the way it does without reading
the whole history.

## Structure

```
context/
  journal/   NNNN-slug.md   append-only. What was attempted, what happened, what it cost.
  adr/       NNNN-slug.md   decisions that constrain code. Superseded, never deleted.
  spec/                     the source specification and its amendments.
```

## Rules

1. **Journal entries are append-only.** If an entry turns out to be wrong, write
   a new entry that says so and link back. Do not edit history.
2. **An ADR is written when a decision closes off an alternative.** If the choice
   was obvious and reversible, it is a journal note, not an ADR.
3. **Every ADR states what it forecloses.** A decision with no cost is not a
   decision, it is a default.
4. **Measurements go in the journal with the command that produced them.** A
   number without a reproduction is a rumour.
5. **Open questions are tracked in `adr/0000-open-questions.md`** and closed by
   later ADRs that reference them.

## Status vocabulary

| Status | Meaning |
|---|---|
| `proposed` | written, not yet load-bearing in code |
| `accepted` | code depends on this |
| `superseded by NNNN` | replaced; kept for the reasoning trail |
| `withdrawn` | abandoned before it was implemented |
