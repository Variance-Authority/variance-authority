# @variance-authority/session

**Requires:** a live DOM, and a `mount` function you write. It knows about React
only through that function, so a session runs whatever a caller can put on a
page.

Run many subjects in one standing world.

## The saving, and what it buys with

Nothing is torn down between subjects: no fresh jsdom per file, no browser per
story, no Storybook reload, no re-parsing the design system's stylesheet.
**Measured at 3.4× faster, with probe overhead around 2% of session time.**

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

Isolation is an enemy of cost. Attribution is not.

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

**`verify` takes the renderer back, and that is not a convenience.** Confirming a
suspicion means rendering the subject again and seeing whether its hash moves,
and a `verify` that could not re-render would have to assert the coupling from
the evidence alone — a finding shaped like proof with no replay behind it, which
is worse than the silence it replaces.

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

## Honest limit

**Module-level state is outside the probe.** A singleton store or a cached client
cannot be seen. Confirmation still catches the symptom — the same subject
producing a different hash with no code change — and attribution correctly
reports no culprit rather than inventing one.
