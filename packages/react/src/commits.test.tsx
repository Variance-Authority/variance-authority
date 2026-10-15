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

const { createRoot, hydrateRoot } = await import('react-dom/client');
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

/** The `FiberRoot` React keeps on a container. */
function fiberRootOn(node: Node): object {
  const record = node as unknown as Record<string, { readonly stateNode: object } | undefined>;
  const key = Object.keys(record).find((name) => name.startsWith('__reactContainer$'));
  const fiber = key === undefined ? undefined : record[key];
  if (fiber === undefined) throw new Error('no React root on the container');
  return fiber.stateNode;
}

/** Commits and their effects outside `act`, which would flush them inside its own scope. */
async function unacted(run: () => Promise<void>): Promise<void> {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  env.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    await run();
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = true;
  }
}

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

  it('refuses to write a hook for a caller that could not have been first', () => {
    // The shape of a collector reached through an import of the application's
    // own React: no hook, and no standing to create one `react-dom` would read.
    const scope: Record<string, unknown> = {};
    const late = tapCommits({ scope, createHook: false });

    expect(late.attached).toBe(false);
    expect(late.reason).toBe('no-hook');
    expect(scope['__REACT_DEVTOOLS_GLOBAL_HOOK__']).toBeUndefined();
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

describe('effects a commit left', () => {
  /**
   * The window a commit leaves: React has committed and told the hook, and the
   * effects of that commit have not run. An effect that sets state is the next
   * commit, so a reader that took the commit for the end of the work read the
   * page one change early. Rendered outside `act`, which runs effects before it
   * returns and would close the window this reads.
   */
  it('counts a commit as unfinished until React has run its passive effects', async () => {
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    env.IS_REACT_ACT_ENVIRONMENT = false;
    const atCommit: boolean[] = [];
    let ran = false;
    function Effect() {
      useEffect(() => {
        ran = true;
      }, []);
      return h('span', null, 'effect');
    }

    const tap = tapCommits({ onCommit: () => atCommit.push(tap.effectsPending()) });
    try {
      root.render(h(Effect, null));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(atCommit).toEqual([true]);
      expect(ran).toBe(true);
      expect(tap.effectsPending()).toBe(false);
    } finally {
      tap.stop();
      env.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });

  it('counts a commit with no passive effects as finished when it commits', async () => {
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    env.IS_REACT_ACT_ENVIRONMENT = false;
    const atCommit: boolean[] = [];
    const tap = tapCommits({ onCommit: () => atCommit.push(tap.effectsPending()) });
    try {
      root.render(h('span', null, 'still'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(atCommit).toEqual([false]);
    } finally {
      tap.stop();
      env.IS_REACT_ACT_ENVIRONMENT = true;
    }
  });

  it('says which root still has effects to run', async () => {
    function Effect() {
      useEffect(() => {}, []);
      return h('span', null, 'effect');
    }
    const other = document.createElement('div');
    document.body.appendChild(other);
    const still = createRoot(other);
    const asked: boolean[] = [];
    const tap = tapCommits({
      onCommit: () => asked.push(tap.effectsPending(fiberRootOn(container)), tap.effectsPending(fiberRootOn(other))),
    });
    await unacted(async () => {
      try {
        still.render(h('span', null, 'still'));
        await new Promise((resolve) => setTimeout(resolve, 20));
        root.render(h(Effect, null));
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(asked).toEqual([false, false, true, false]);
      } finally {
        tap.stop();
        still.unmount();
        other.remove();
      }
    });
  });

  it('counts the effects as run when the hook before it throws on hearing so', async () => {
    const hook = (globalThis as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'] as {
      onPostCommitFiberRoot?: (...args: unknown[]) => void;
    };
    const original = hook.onPostCommitFiberRoot;
    hook.onPostCommitFiberRoot = () => {
      throw new Error('a harness that breaks');
    };
    function Effect() {
      useEffect(() => {}, []);
      return h('span', null, 'effect');
    }
    const tap = tapCommits();
    await unacted(async () => {
      try {
        root.render(h(Effect, null));
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(tap.commits()).toHaveLength(1);
        expect(tap.effectsPending()).toBe(false);
      } finally {
        tap.stop();
        hook.onPostCommitFiberRoot = original;
      }
    });
  });
});

describe('a root that hydrates', () => {
  /**
   * What the hydration commit leaves survives only until what runs after it: an
   * effect can rewrite it, and nothing in the document then
   * says what it was. The tap keeps it, and the root's own commits after it.
   */
  it('keeps the markup at the hydration commit and the commits that changed it', async () => {
    function Mounted() {
      const [mounted, setMounted] = useState(false);
      useEffect(() => setMounted(true), []);
      return h('p', null, mounted ? 'client' : 'server');
    }
    const served = document.createElement('div');
    served.innerHTML = '<p>server</p><img src="/never-fetched.png">';
    document.body.appendChild(served);
    const tap = tapCommits();
    await unacted(async () => {
      try {
        const hydrated = hydrateRoot(served, [h(Mounted, { key: 'p' }), h('img', { key: 'i', src: '/never-fetched.png' })]);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(served.firstElementChild?.outerHTML).toBe('<p>client</p>');

        const hydration = tap.hydration(fiberRootOn(served));
        expect((hydration?.markup as Element | undefined)?.innerHTML).toBe('<p>server</p><img src="/never-fetched.png">');
        expect(hydration?.markup.ownerDocument).not.toBe(document);
        expect(hydration?.commits().map((commit) => commit.components)).toEqual([['Mounted']]);
        expect(tap.hydration(fiberRootOn(container))).toBeUndefined();
        hydrated.unmount();
      } finally {
        tap.stop();
        served.remove();
      }
    });
  });

  it('keeps as many commits since the hydration as the tap keeps, the latest', async () => {
    function Counting() {
      const [count, setCount] = useState(0);
      useEffect(() => {
        if (count < 3) setCount(count + 1);
      }, [count]);
      return h('p', null, String(count));
    }
    const served = document.createElement('div');
    served.innerHTML = '<p>0</p>';
    document.body.appendChild(served);
    const tap = tapCommits({ keep: 2 });
    await unacted(async () => {
      try {
        const hydrated = hydrateRoot(served, h(Counting, null));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(served.textContent).toBe('3');

        const since = tap.hydration(fiberRootOn(served))?.commits() ?? [];
        expect(since.map((commit) => commit.components)).toEqual([['Counting'], ['Counting']]);
        expect(since.map((commit) => commit.at)).toEqual(tap.commits().map((commit) => commit.at));
        hydrated.unmount();
      } finally {
        tap.stop();
        served.remove();
      }
    });
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

    // Ticking stops before the root unmounts, so no update is still queued on a
    // fiber the unmount deletes.
    const ticking = { on: true };
    function Ticker() {
      const [n, setN] = useState(0);
      useEffect(() => {
        const id = setInterval(() => {
          if (ticking.on) setN((value) => value + 1);
        }, 5);
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

    ticking.on = false;
    expect((await awaitQuiet(tap, { quietFor: 20, timeout: 250 })).settled).toBe(true);
    tap.stop();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
});
