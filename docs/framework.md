# When React changes but the rendered page does not

A form renders correctly and its screenshot passes. A child component declared
inside the form is nevertheless rebuilt on every parent render, so the next
validation update discards what the user typed. Before that interaction, the
stable and broken versions produce the same document. The capture describes
what is on screen; it cannot say whether that component will survive.

This page is the task-oriented path through the React evidence you can read
beside the rendered document, for the failure above: the document is identical
on both sides and the difference is in the component tree. Read it when a
screenshot passes and the component still behaves wrongly.

New here? Start with [your first run](start.md).

A **subject** is one named UI state you asked for and can ask for again, under a
stable id you choose such as `story:checkout--empty`. Everything on this page
reads the React tree inside one subject.

This path is **React-only** and needs a live client tree mounted by `react-dom`.
For Vue, Svelte, static HTML or server-rendered markup that was never hydrated,
use the document and raster evidence instead; there is no React tree to inspect.

```bash
npm install --save-dev @variance-authority/react
```

## Choose the evidence for the failure

Pick the row that matches what happened in your test.

| What happened in practice | Evidence to use | What it gives you |
|---|---|---|
| State, focus, scroll or an uncontrolled input resets during an interaction | [`markRender` before the action, then `remountedSince` afterwards](framework-reference.md#markrender-and-remountedsince) | The components rebuilt during that interval, their owners and any reconciliation key |
| Two components render the same document but differ in hooks, wrappers, context subscriptions or keys | [`wiringOf`](framework-reference.md#wiringof) | The hooks, wrappers, context subscriptions and keys behind each node, in a form that compares across runs |
| Two renderings differ and you need to know which prop, context or hook cell parted first | [`holdingOf` and parting](parting.md) | The first prop, context value or hook cell where the two readings differed, and what it changed downstream |
| A capture may be a Suspense fallback rather than the intended state | [Suspense arrival checks](stabilization.md#pendingsuspense--the-boundary-that-has-not-arrived-by-name) | A wait followed by a refusal that names the unresolved boundary |
| The page keeps committing and you need to know which components are active | [The commit tap](stabilization.md#tapcommits--which-components-rendered-and-when-they-stopped) | A component-level quiet check, provided the tap was installed before `react-dom` loaded |

## Where wiring is read for you, and where you ask for it

The route, Storybook, Playwright and Vitest Browser integrations read wiring by
default. Set `wiring: false` when the page has no React tree, so the walk does
not visit every node to report an absent result. Lower-level capture calls do
not choose a framework for you; pass `wiringOf` explicitly.

Wiring describes one state of a component, so it is recorded with the rest of
the capture and compared against the baseline. A remount describes an interval
between two points in a test, so you ask for it around an action instead and it
enters no comparison.

The [reference](framework-reference.md#wiringof) defines the recorded fields,
the absence rules, and what enters a comparison.

## Remounts: what the document cannot show you

Use the remount path when a test can already reach the mounted state and perform
the action that triggers the reset. Take the mark after setup is complete and
immediately before that action; a mark taken after the action has no earlier
instance to compare with.

This complete Vitest example contains the defect deliberately: `InlineCounter`
is declared inside `Screen`, so each render creates a new component type. The
test reports both the rebuilt component and the consequence to the user. Save it
as a `.ts` test file; besides `@variance-authority/react` it needs `vitest`,
`jsdom`, and the `react` and `react-dom` your application already has.

```ts
// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { markRender, remountedSince } from '@variance-authority/react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('a parent update preserves the counter', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  function Counter({ tick }: { tick: number }) {
    const [clicks, setClicks] = useState(0);
    return h(
      'button',
      { onClick: () => setClicks((value) => value + 1) },
      `${String(clicks)} of ${String(tick)}`,
    );
  }

  function Screen({ tick }: { tick: number }) {
    function InlineCounter() {
      return h(Counter, { tick });
    }
    return h('main', { 'data-subject': '' }, h(InlineCounter));
  }

  try {
    await act(async () => root.render(h(Screen, { tick: 0 })));

    const subject = host.querySelector('[data-subject]');
    const button = host.querySelector('button');
    if (subject === null || button === null) throw new Error('subject did not mount');

    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const mark = markRender(subject);

    await act(async () => root.render(h(Screen, { tick: 1 })));

    const accidental = remountedSince(subject, mark)
      .filter((entry) => entry.key === undefined)
      .map((entry) => ({ component: entry.name, inside: entry.owners }));

    expect({ accidental, text: subject.querySelector('button')?.textContent }).toEqual({
      accidental: [],
      text: '1 of 1',
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
```

As written, the received value names `InlineCounter` and `Counter`, and the text
is `0 of 1`. Move `InlineCounter` outside `Screen` and pass `tick` as a prop; the
same assertion then has no accidental remounts and the counter retains `1 of 1`.
That is the completion condition: the action preserves the state the user had,
and the interval contains no unkeyed rebuild.

A reported key changes the interpretation, not the observation. React was asked
to create a fresh instance under that key; check whether the key was intended to
change for this action before treating the remount as a defect.

## Continue from the result

After the focused test passes, capture and compare that subject the usual way,
so the fix is also checked against its rendered and accessibility evidence — see
[your first run](start.md). Use the
[React evidence reference](framework-reference.md) when you need exact return
shapes, the defaults each integration applies, or the limits of fiber matching.
Use [parting](parting.md) when the component survived but its inputs led to a
different rendering, and [stabilization](stabilization.md) when the state was
read before it had finished arriving.
