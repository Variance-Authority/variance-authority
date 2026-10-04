# Check an edit you made

You changed UI code and the suite ran. Before anybody opens a screenshot, you
can know whether the edit landed, what else it moved, which declaration moved
it and by how many pixels, and settle the part that was intended. This is the
order. Each step reads what the run already left; none of them re-renders.

## 1. Declare, then edit

Write the claims file before the edit, while you still know only what you
meant. The format is in [ask a run](ask-a-run.md#declare-before-you-read-the-claims-file).
One claim per component you mean to change, with the reason in your words and
`maxSubjects` when you know the reach:

```json
[{ "root": "component:Button", "reason": "roomier padding on every button", "maxSubjects": 4 }]
```

Then edit, and run the suite with the project's own runner. The run compares
every subject against its accepted baseline and writes the report every
command below reads: the config's `report` path, `.variance/report.json` by
default. [Ask a run](ask-a-run.md#check-before-the-first-question) lists what
has to hold before that report can answer.

## 2. Adjudicate

```bash
variance adjudicate --claims claims.json
```

Read the verdicts in this order, because each one changes what the next means.
`delivered`, the one you are aiming for, needs nothing: the component you
declared changed, within the reach you declared.

- **`undelivered`** — the component rendered and did not change. Your edit did
  not take: a wrong file, a dead branch, a rule that overrides it, or a stale
  build. Fix that and run again before reading anything else.
- **`unclaimed`** — something you did not declare moved. Either your edit
  reached further than you meant, or the claim is missing. Step 3 tells you
  which.
- **`overreached`** — the change is yours and it reached more subjects than you
  declared.
- **`unobservable`** — the run never rendered that component, or kept no
  component census that records whether it did. Nothing here is evidence about
  it; say so rather than calling it delivered.

`[ungrouped]` names changed subjects no claim could be checked against, and
`[not observed]` the subjects the run did not look at.

## 3. Read what moved, per component

```bash
variance ask changes
variance ask describe --subject story:case-surface--card-with-actions
```

`changes` prints how many distinct changes there are and which subjects each one
reaches, and ends each change with the `variance accept --shape` line that
settles it. Ask `describe` for one subject per change. It prints the
components that moved, then the regions — the rectangles where pixels differ —
each with the component and `file:line` it was traced to. The components are
read from the two runs' component hashes, not from pixels, so they hold when a
reflow merged your edit and everything it pushed into one region:

```
components:
  cause      Button — geometry, token; box 0 × +6 px
      padding-bottom 12px → 15px
      padding-left 18px → 24px
      padding-right 18px → 24px
      padding-top 12px → 15px
  collateral Card — geometry; box 0 × +12 px
  collateral Stack — geometry; box 0 × +12 px

  cause      113px at 154,85 24×18 — Button
      in button "Pay"
      cases/storybook-case/src/ds.jsx:53
      shape v1:2eca3d781412be67b07b3777f9dd7784
```

- **`cause` or `collateral`.** A cause changed on its own; a collateral
  component moved because something inside or beside it did. An unclaimed
  collateral under your cause is your edit's reach, and not a second change.
- **The bands name the kind of change.** `geometry` means boxes appeared,
  vanished, moved or resized, which is how a DOM change shows. `token` means
  style values changed. `content` means only text changed. `a11y` means a role,
  accessible name or ARIA state changed. `texture` means painted pixels changed
  with nothing structural behind them. `token` without `geometry` is a
  restyle that moved nothing. `geometry` without `token` on a cause means its
  markup changed — a tag, an attribute, a child — and no style value did.
- **`box W × H px`** is how much each instance of the component grew, in CSS
  pixels. A negative number shrank. It is printed only when every instance
  grew by the same amount; instances that disagree, or a count of instances
  that changed, leave it out.
- **The indented lines are the declarations that changed**, as `property from →
  to`. Values are what the browser computed for a property some rule declared,
  so a `1.5rem` reads `24px`. A custom property is listed under its own name,
  `--accent`. `(not declared)` on one side means no rule set the property on
  that side, so the edit added or removed the declaration itself. When a
  component has several instances with different values, only the values that
  changed are listed.

A `token` cause with no indented lines moved, and this record does not hold
which value did: the baseline was accepted before declared values were recorded,
or instances traded values with each other so that every property still holds
the same set. Read the source at the `file:line` under the component's region.

`report.json` lists the same record per subject in `moved[]`: `component`,
`bands`, `cause`, `presence` (`added` or `removed`, for a component on one side
only), `grew` and `changed`. `moved` is absent when neither run supplied
component hashes, and `presence`, `grew` and `changed` are each absent when the
record does not hold them. Absent means unknown, not unchanged.

## 4. Correct, and run again

When an `unclaimed` or `overreached` component is not what you meant, fix the
source and repeat from step 2 with the same claims file. Do not widen the claims
to match the run: claims copied from the result score the run against itself.
You are done when every claim is `delivered` and nothing is `unclaimed` that
you cannot name a reason for.

## 5. Settle what was intended

```bash
variance ask changelog --shape v1:2eca3d781412be67b07b3777f9dd7784
variance accept --shape v1:2eca3d781412be67b07b3777f9dd7784
```

Ask `changelog` before you accept: it previews what accepting that shape would
write into the baseline changelog. Accepting by shape promotes every subject
where that shape is the whole change, and lists each subject it refused because
something else moved there too. Those need a `describe` of their own, and an
accept by subject id once you know what the other change is.

Whether an agent may accept here is the project's policy, not this tool's. If
nobody has told you that you may, propose the command instead of running it.
