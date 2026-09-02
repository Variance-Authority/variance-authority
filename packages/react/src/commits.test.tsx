// @vitest-environment jsdom
//
// The tap is the one thing in this package that has to exist before React does,
// so the file is arranged around that: `tapCommits()` runs at module scope and
// `react-dom` is imported dynamically underneath it. A static import would run
// react-dom's module body first, the hook would be installed too late, and every
// assertion below would pass against a tap that never heard anything — which is
// exactly the silent failure `attached` exists to make impossible.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { awaitQuiet, tapCommits } from './index.js';

// Installed first, and never stopped: it owns the hook object every per-test tap
// then wraps.
const installed = tapCommits();

const { createRoot } = await import('react-dom/client');
const { createElement: h, act, memo, useEffect, useState } = await import('react');

type Root = ReturnType<typeof createRoot>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

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

describe('attaching', () => {
  it('is attached, and knows the exact React version', () => {
    expect(installed.attached).toBe(true);
    // `runtime.ts` can only bound the major version from an expando prefix. A
    // renderer that injected states it outright, which is the one thing the hook
    // buys that traversal cannot.
    expect(installed.reactVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('refuses rather than reporting silence when React already mounted', async () => {
    // A document that already holds a React container, with no hook in the
    // scope: the shape of a page instrumented one script too late.
    const mounted = document.createElement('div');
    (mounted as unknown as Record<string, unknown>)['__reactContainer$fake'] = {};
    document.body.appendChild(mounted);

    const late = tapCommits({ scope: { document } });

    expect(late.attached).toBe(false);
    expect(late.reason).toBe('react-already-loaded');
    // The distinction the whole refusal exists for: an unattached tap must not
    // be readable as a quiet page.
    expect(late.commits()).toEqual([]);
    await expect(awaitQuiet(late)).resolves.toMatchObject({ settled: false });

    mounted.remove();
  });

  it('calls the handler it wrapped, and puts it back when it stops', async () => {
    const hook = (globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as {
      onCommitFiberRoot?: ((...args: unknown[]) => void) | undefined;
    };
    const original = hook.onCommitFiberRoot;

    // Stand in for the DevTools extension, or any other harness already there.
    let theirs = 0;
    hook.onCommitFiberRoot = () => {
      theirs += 1;
    };
    const mine = hook.onCommitFiberRoot;

    const tap = tapCommits();
    await render(h('span', null, 'one'));

    expect(theirs).toBe(1);
    expect(tap.commits()).toHaveLength(1);

    tap.stop();
    expect(hook.onCommitFiberRoot).toBe(mine);

    await render(h('span', null, 'two'));
    // Theirs keeps working; ours has stopped recording rather than kept a
    // detached listener alive.
    expect(theirs).toBe(2);
    expect(tap.commits()).toHaveLength(1);

    hook.onCommitFiberRoot = original;
  });
});

describe('what a commit says', () => {
  it('names the components that rendered, and not the ones that bailed out', async () => {
    const Quiet = memo(function Quiet() {
      return h('em', null, 'quiet');
    });
    Quiet.displayName = 'Quiet';

    let bump!: () => void;
    function Restless() {
      const [n, setN] = useState(0);
      bump = () => setN((value) => value + 1);
      return h('span', null, String(n));
    }
    function Shell() {
      return h('div', null, h(Restless, null), h(Quiet, null));
    }

    const tap = tapCommits();
    await render(h(Shell, null));

    expect(tap.commits()).toHaveLength(1);
    expect(tap.commits()[0]?.components).toEqual(['Shell', 'Restless', 'Quiet']);

    await act(async () => {
      bump();
    });

    // The memoised sibling did not render, and a report that named it would send
    // a reader to a component that did nothing.
    expect(tap.commits()).toHaveLength(2);
    expect(tap.commits()[1]?.components).toEqual(['Restless']);
    expect(tap.commits()[1]?.updaters).toMatchObject([
      { path: [{ name: 'Restless' }, { name: 'Shell' }] },
    ]);
    tap.stop();
  });

  it('calls a commit observer with the same bounded evidence the tap retains', async () => {
    const observed: unknown[] = [];
    let bump!: () => void;
    function Counter() {
      const [value, setValue] = useState(0);
      bump = () => setValue((current) => current + 1);
      return h('span', null, String(value));
    }

    const tap = tapCommits({ onCommit: (commit) => observed.push(commit) });
    await render(h(Counter, null));
    await act(async () => bump());

    expect(observed).toEqual(tap.commits());
    expect(tap.commits()[1]?.updaters?.[0]?.path[0]?.name).toBe('Counter');
    tap.stop();
  });

  it('drops the oldest commits rather than growing without bound, and counts them', async () => {
    let bump!: () => void;
    function Counter() {
      const [n, setN] = useState(0);
      bump = () => setN((value) => value + 1);
      return h('span', null, String(n));
    }

    const tap = tapCommits({ keep: 3 });
    await render(h(Counter, null));
    for (let index = 0; index < 5; index += 1) {
      await act(async () => {
        bump();
      });
    }

    expect(tap.commits()).toHaveLength(3);
    expect(tap.dropped()).toBe(3);
    tap.stop();
  });
});

describe('waiting for quiet', () => {
  it('settles on a page that has finished', async () => {
    function Still() {
      return h('span', null, 'done');
    }

    const tap = tapCommits();
    await render(h(Still, null));

    const quiet = await awaitQuiet(tap, { quietFor: 30, timeout: 500 });

    expect(quiet.settled).toBe(true);
    expect(quiet.commits).toBe(0);
    expect(quiet.restless).toEqual([]);
    tap.stop();
  });

  it('names what is still moving on a page that never settles', async () => {
    // React's act environment is off for this one on purpose: the whole subject
    // is a page committing outside anybody's control, which is what a real
    // ticker does and what `act` exists to prevent.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

    function Ticker() {
      const [n, setN] = useState(0);
      useEffect(() => {
        const id = setInterval(() => setN((value) => value + 1), 5);
        return () => clearInterval(id);
      }, []);
      return h('span', null, String(n));
    }
    function Page() {
      return h('div', null, h(Ticker, null));
    }

    const tap = tapCommits();
    root.render(h(Page, null));
    await new Promise((resolve) => setTimeout(resolve, 30));

    const quiet = await awaitQuiet(tap, { quietFor: 60, timeout: 250 });

    expect(quiet.settled).toBe(false);
    expect(quiet.commits).toBeGreaterThan(0);
    // The sentence a reader gets instead of a screenshot timeout.
    expect(quiet.restless[0]?.name).toBe('Ticker');
    expect(quiet.restless[0]?.commits).toBeGreaterThan(1);
    // `Page` rendered once, at mount, and never again — so it is not in the list
    // at all rather than sitting at the bottom of it.
    expect(quiet.restless.map((entry) => entry.name)).not.toContain('Page');

    tap.stop();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
});
