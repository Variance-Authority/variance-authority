# When React changes but the rendered page does not

A form renders correctly and its screenshot passes. A child component declared
inside the form is nevertheless rebuilt on every parent render, so the next
validation update discards what the user typed. Before that interaction, the
stable and broken versions produce the same document. The capture describes
what is on screen; it cannot say whether that component will survive.

[Variance Authority](README.md) can read
[React evidence](framework-reference.md) beside the document to answer that
kind of question. This path is **React-only** and needs a live client tree
mounted by `react-dom`. For Vue, Svelte, static HTML or server-rendered markup
that was never hydrated, use the document and raster evidence instead; there is
no React tree to inspect.

## Choose the evidence for the failure

Start with what you need to learn, not with the shape of React's internals.

| What happened in practice | Evidence to use | What it gives you |
|---|---|---|
| State, focus, scroll or an uncontrolled input resets during an interaction | [`markRender` before the action, then `remountedSince` afterwards](framework-reference.md#markrender-and-remountedsince) | The components rebuilt during that interval, their owners and any reconciliation key |
| Two components render the same document but differ in hooks, wrappers, context subscriptions or keys | [`wiringOf`](framework-reference.md#wiringof) | Stable component wiring that can be digested and compared without treating hook values as identity |
| Two renderings differ and you need to know which prop, context or hook cell parted first | [`holdingOf` and parting](parting.md) | One-way evidence about the inputs each component held, outside every baseline hash |
| A capture may be a Suspense fallback rather than the intended state | [Suspense arrival checks](stabilization.md#pendingsuspense--the-boundary-that-has-not-arrived-by-name) | A wait followed by a refusal that names the unresolved boundary |
| The page keeps committing and you need to know which components are active | [The commit tap](stabilization.md#tapcommits--which-components-rendered-and-when-they-stopped) | A component-level quiet check, provided the tap was installed before `react-dom` loaded |

## Wiring: a sixth digest

The shipped route, Storybook, Playwright and Vitest Browser integrations read
wiring by default. Set `wiring: false` for a non-React surface where the walk can
only produce an absent result. Lower-level `collect` and unit-capture calls do
not choose a framework for you; pass `wiringOf` explicitly.

Wiring describes a revision, so it is safe to digest. A remount describes an
interval, so it is a finding you ask for around an action. Keeping those paths
separate prevents an ordinary second reading from reporting the act of
measurement as a change.

The [reference](framework-reference.md#wiringof) defines the recorded fields,
absence rules and digest boundary.

## Remounts: what the document cannot show you

Use the remount path when a test can already reach the mounted state and perform
the action that triggers the reset. Take the mark after setup is complete and
immediately before that action; a mark taken after the action has no earlier
instance to compare with.

This complete Vitest example contains the defect deliberately: `InlineCounter`
is declared inside `Screen`, so each render creates a new component type. The
test reports both the rebuilt component and the consequence to the user.

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

After the focused test passes, run the normal subject observation so the fix is
also checked against its rendered and accessibility evidence. Use the
[React evidence reference](framework-reference.md) when you need exact return
shapes, collector defaults or the limits of fiber matching. Use
[parting](parting.md) when the component survived but its inputs led to a
different rendering, and [stabilization](stabilization.md) when the state was
read before it had finished arriving.
