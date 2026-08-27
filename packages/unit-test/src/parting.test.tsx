// @vitest-environment jsdom
//
// The mechanic end to end, through the public entry point: render, read, change
// one thing, read again, ask what parted. Everything asserted below comes out of
// a real fiber — no fixture writes the hook cell that carries the answer.

import { explainParting, partingOf, type SemanticSnapshot } from '@variance-authority/core';
import { holdingOf, provenanceOf, wiringOf } from '@variance-authority/react';
import { act, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capture } from './capture.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT = {
  width: 320,
  height: 200,
  deviceScaleFactor: 1,
  colorScheme: 'light',
} as const;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(element: unknown): Promise<void> {
  await act(async () => {
    root.render(element as never);
  });
}

/** One reading of the mounted tree, with all three framework readers attached. */
async function read(): Promise<SemanticSnapshot> {
  const artifact = await capture(container.firstElementChild!, {
    subject: 'cart',
    viewport: VIEWPORT,
    provenanceOf,
    wiringOf,
    holdingOf,
  });
  return artifact.snapshot;
}

/** The branch. A `<p>` on one side and a `<span>` on the other. */
function Summary({ total, expanded }: { total: number; expanded: boolean }) {
  return expanded ? <p>{total} items in your cart</p> : <span>{total}</span>;
}

let expand = (): void => {};

function Cart() {
  const [expanded, setExpanded] = useState(false);
  expand = () => setExpanded(true);
  return (
    <div>
      <Summary total={3} expanded={expanded} />
    </div>
  );
}

describe('one page, read twice, with a hook moved between the readings', () => {
  it('names the hook cell rather than the tag it produced', async () => {
    await render(<Cart />);
    const before = await read();
    await act(async () => {
      expand();
    });
    const after = await read();

    const parting = partingOf(before, after);

    // The tag moved — that much a diff already says.
    expect(parting.deltas.length).toBeGreaterThan(0);

    // What it could not say: which of the two components decided, and on what.
    expect(parting.origins?.map((entry) => entry.component)).toEqual(['Cart']);
    expect(parting.origins?.[0]?.rung).toBe('stateful');
    expect(parting.origins?.[0]?.inputs).toMatchObject([
      { kind: 'hook', name: 'useState', index: 0 },
    ]);
  });

  it('names the one prop that carried the decision down', async () => {
    await render(<Cart />);
    const before = await read();
    await act(async () => {
      expand();
    });
    const parting = partingOf(before, await read());

    // `Summary` receives `total` and `expanded`. Only one of them moved, and
    // saying which is spec 0024's map doing the job a whole-props digest cannot.
    const summary = parting.boundaries?.find((entry) => entry.component === 'Summary');
    expect(summary?.rung).toBe('handed');
    expect(summary?.inputs.map((input) => input.name)).toEqual(['expanded']);
  });

  it('speaks the three rungs in one report', async () => {
    await render(<Cart />);
    const before = await read();
    await act(async () => {
      expand();
    });
    const lines = explainParting(partingOf(before, await read()));

    expect(lines[0]).toBe('Cart chose differently — useState #0 moved');
    expect(lines).toContain('  manifests as Summary was handed a different `expanded`');
  });

  it('reports two readings of an unchanged page as parting nowhere', async () => {
    // Stability, which is the same question asked of one subject twice. A
    // boundary list that is present and empty is the reading; an absent one
    // would mean nobody looked.
    await render(<Cart />);
    const parting = partingOf(await read(), await read());

    expect(parting.identical).toBe(true);
    expect(parting.boundaries).toEqual([]);
    expect(parting.origins).toBeUndefined();
  });
});

describe('the last joint: what the prop turned into on the page', () => {
  // The chain the rungs exist to climb runs state -> prop -> attribute -> pixel.
  // A boundary that reports a count and a band has stopped one link short of the
  // thing somebody staring at a visual regression is trying to name.
  function Badge({ tone, count }: { tone: string; count: number }) {
    return (
      <span
        className={`badge badge--${tone}`}
        aria-label={`${count} ${tone} messages`}
        style={{
          color: tone === 'alert' ? 'rgb(200 0 0)' : 'rgb(100 100 100)',
          padding: tone === 'alert' ? '8px' : '2px',
        }}
      >
        {count}
      </span>
    );
  }

  let promote = (): void => {};
  function Inbox() {
    const [urgent, setUrgent] = useState(false);
    promote = () => setUrgent(true);
    return (
      <div>
        <Badge tone={urgent ? 'alert' : 'muted'} count={7} />
      </div>
    );
  }

  it('names the properties the moved prop produced', async () => {
    await render(<Inbox />);
    const before = await read();
    await act(async () => {
      promote();
    });
    const parting = partingOf(before, await read());

    const badge = parting.boundaries?.find((entry) => entry.component === 'Badge');
    expect(badge?.rung).toBe('handed');
    expect(badge?.inputs.map((input) => input.name)).toEqual(['tone']);

    // `class` is not admitted and `data-*` is not either, so the class name
    // churn a component library emits is not what lands here. The resolved
    // style is, and that is the half a picture would have shown.
    expect(badge?.moved).toEqual([
      'color',
      'padding-bottom',
      'padding-left',
      'padding-right',
      'padding-top',
    ]);

    expect(explainParting(parting)).toContain(
      '    7 deltas here (a11y, token) — color, padding-bottom, padding-left, padding-right and 1 more',
    );
  });
});

describe('a component whose inputs did not move and whose output did', () => {
  // The flake case. A component with no props and no hooks is not unreadable in
  // a development build — React writes `_debugHookTypes = null` on every fiber
  // and fills it on the first hook call, so "ran no hooks" is a reading. Losing
  // that distinction reports the one shape worth calling nondeterministic as
  // one nothing can be said about.
  function Seat() {
    return <div>{Math.random() > 0.5 ? 'aisle' : 'window'}</div>;
  }

  it('calls it nondeterministic rather than unreadable', async () => {
    await render(<Seat />);
    let before = await read();
    let after = before;
    for (let attempt = 0; attempt < 60 && after.renderHash === before.renderHash; attempt += 1) {
      await render(<span />);
      await render(<Seat />);
      after = await read();
    }
    expect(after.renderHash).not.toBe(before.renderHash);

    const parting = partingOf(before, after);

    expect(parting.origins?.[0]).toMatchObject({ component: 'Seat', rung: 'undetermined' });
    expect(explainParting(parting)[0]).toBe(
      'Seat rendered differently from inputs that all agreed — nondeterministic',
    );
  });
});

describe('state that does not live in React', () => {
  function makeStore(initial: string) {
    let value = initial;
    const listeners = new Set<() => void>();
    return {
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      read: () => value,
      set(next: string) {
        value = next;
        for (const listener of listeners) listener();
      },
    };
  }

  it('names the external subscription, not the component that read it', async () => {
    // Every store in the ecosystem reaches React through this one hook, so the
    // single row for it covers Redux, Zustand, Jotai, valtio and a URL alike.
    const store = makeStore('control');

    function Arm() {
      const arm = useSyncExternalStore(store.subscribe, store.read);
      return (
        <div>
          <Summary total={3} expanded={arm === 'treatment'} />
        </div>
      );
    }

    await render(<Arm />);
    const before = await read();
    await act(async () => {
      store.set('treatment');
    });

    const parting = partingOf(before, await read());

    expect(parting.origins?.[0]).toMatchObject({ component: 'Arm', rung: 'external' });
    expect(explainParting(parting)[0]).toBe(
      'Arm read a different external store — useSyncExternalStore #0 moved',
    );
  });
});
