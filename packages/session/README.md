<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/session

**Requires:** a live DOM, and a `mount` function you write. It knows about React
only through that function, so a session runs whatever a caller can put on a
page.

Run many subjects in one standing world.

A session is the **runner**, not an instrument bolted onto one: it creates the
container, subjects arrive through `session.run`, and taking it means writing your
collection around it rather than adding a probe to a loop you already have. The
detector below is a passenger on that: it brackets the mount, so it can only see
the subjects that went through here.

## The saving, and what it buys with

Nothing is torn down between subjects: no fresh jsdom per file, no browser per
story, no Storybook reload, no re-parsing the design system's stylesheet.
**Measured at 3–4× faster, with probe overhead around 2% of session time.**
`src/cost.test.ts` takes both readings on every run and asserts a floor rather
than the figure — the multiple moves with the machine, and a bound that pinned it
would fail on a loaded CI box and teach everyone to ignore it.

The risk that buys is cross-pollution — one subject leaving state another one
reads. The industry answer is to rinse between subjects, and rinsing is exactly
the cost we just removed.

## So it detects instead of preventing

Every subject is bracketed by a cheap shared-state probe, and its reads are
derived from its own capture. Which turns *"these tests are flaky in CI"* into:

```
[confirmed] story:card
  cause:    story:toolbar (rendered by Button, Toolbar)
  via:      sheet:<style:0>
  evidence: re-running `story:card` in the same session produced a different
            render hash with no code change; `story:toolbar` wrote
            `sheet:<style:0>`, which this subject matched via `.card`
  fix:      make `story:toolbar` clean up `sheet:<style:0>`, or scope it so it
            cannot reach `story:card`
```

Isolation is an enemy of cost and detection is not, which is the half that
generalises. Naming the writer is the narrow half: a `via:` line can only ever be
something the document can read about itself — a stylesheet, a root custom
property, an attribute on the root or body, a stray body child, the title. That
set was chosen for cost and it is the right set for the cost; it is also a small
fraction of the ways one subject reaches another.

See [ADR-0009](../../docs/context/adr/0009-sessions-detect-instead-of-rinse.md).

## Usage

```ts
import { createSession } from '@variance-authority/session';

const session = createSession({ document, viewport, engine: 'jsdom@30' });
const root = createRoot(session.container);        // one root per session — see below

// One function, used twice: once to collect, and once to replay.
const render = (ref: { readonly id: string }): void => {
  root.render(subjects.find((subject) => subject.ref.id === ref.id)?.element);
};

for (const subject of subjects) session.run(subject.ref, () => render(subject.ref));

const findings = session.verify(render);           // confirmed | suspected, with a cause and a fix
```

`createSession` takes:

| option | default | what it decides |
|---|---|---|
| `document` | required | the live DOM the container is appended to |
| `viewport` | required | width, height, scale, colour scheme — media conditions are resolved against it |
| `engine` | required | what read the DOM, e.g. `jsdom@30`, as it lands in the identity |
| `fonts` | none | the font stack this session is asserted to have |
| `provenanceOf` | none | element to `Provenance`, so a finding can name the component that wrote a node rather than the node |
| `portalsOf` | none | root to the elements it rendered outside itself. Without it a portal's content is somebody else's body child, which reads as pollution |
| `clearContainer` | `true` | empty the container between subjects. The one teardown a session still performs, because it is the one that is cheap: emptying is proportional to the last subject, rebuilding a document is proportional to everything. `false` models a suite that appends without cleaning up — a real pattern, and one the detector should describe rather than forbid |

`verify(replay, sample?)` takes an optional second argument: the subject ids to
re-run. Omitted, every subject the session saw is replayed. Pass a sample when
confirmation is the expensive half and you already know which subjects are worth
the second pass.

**`verify` takes the renderer back, and that is not a convenience.** Confirming a
suspicion means rendering the subject again and seeing whether its hash moves,
and a `verify` that could not re-render would have to assert the coupling from
the evidence alone — a finding shaped like proof with no replay behind it, which
is worse than the silence it replaces.

`probe`, `diffProbes` and `SheetRegistry` are the bracket itself, exported for a
caller running the detector over a world a session did not create. `probe` takes
`registry` — the `SheetRegistry` whose identities have to survive across both
readings, since a stylesheet has no id of its own — and `ownedContainers`, the
elements whose contents are the subject rather than residue. Without the second
one every subject appears to pollute the body with its own output.

## Two sharp edges, both deliberate

**The container is the same element every run.** React notices: calling
`createRoot` on it twice warns and leaks the previous root. Create one root per
session and `root.render` per subject.

**A subject that renders nothing is refused, not snapshotted.** An empty
container compares equal to every other empty container, so it would report
`unchanged` forever while showing nothing — the exact failure this project
exists to refuse, arriving through the cheapest possible door.

A subject that is not finished when `mount` returns says so by returning a
promise; `run` awaits it and stays entirely synchronous when it does not, because
the synchronous path is the overwhelming majority and the package exists to be
cheap.

## Honest limits

**Detection generalises; attribution does not.** Module-level state — a singleton
store, a cached client, a memoized selector, a mocked clock — is outside the DOM
and so outside the probe, and there is no stack to fall back on: the write
happened during an earlier subject's render, in a frame that returned before this
subject was ever compared. Confirmation still catches the symptom, the same
subject producing a different hash with no code change, and attribution reports no
culprit rather than inventing one.

**Confirmation varies time and holds the world fixed.** Re-running a subject in
the same session proves it is unstable; a leak that happens *every* time renders
the same wrong way in both passes and never moves the hash, so one the probe
never saw either is reported as nothing at all. That is the two limits composing,
and it is the kind that becomes a false regression rather than a flake. Catching
it means varying the world instead — collecting the subject in one nothing else
has touched, which is what a `variance run` asks its collector for when a
subject's pixels moved
([spec 0012](../../docs/specs/0012-order-dependence-in-a-run.md)).
