// @vitest-environment jsdom
//
// Arranged as a runner setup file arranges it: the tap exists before
// `react-dom` runs its module body, so `react-dom/client` is imported below it.

import { act, Component, createContext, memo, use, useContext, useMemo, useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { tapCommits } from './commits.js';
import type { Fiber } from './fiber.js';
import { fiberComponentName } from './names.js';
import { renderCausesOf, type RenderCause } from './renders.js';

const seen: [string, readonly RenderCause[]][] = [];
tapCommits({ onRender: (fiber) => seen.push([fiberComponentName(fiber), renderCausesOf(fiber)]) });

const { createRoot } = await import('react-dom/client');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Render `first`, then `next` into the same root, and what rendered the second time. */
function rerendered(first: ReactElement, next: ReactElement): readonly [string, readonly RenderCause[]][] {
  const root = createRoot(document.createElement('div'));
  act(() => root.render(first));
  seen.length = 0;
  act(() => root.render(next));
  const second = seen.slice();
  act(() => root.unmount());
  return second;
}

function Label({ text, onPick }: { text: string; onPick?: () => void }): ReactElement {
  return <b onClick={onPick}>{text}</b>;
}

const Quiet = memo(function Quiet(): ReactElement {
  return <i />;
});

const Theme = createContext('light');
Theme.displayName = 'Theme';

function Themed(): ReactElement {
  return <p>{useContext(Theme)}</p>;
}

describe('why a component rendered', () => {
  it('reads a mount when there was no render before', () => {
    seen.length = 0;
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Label text="a" />));
    expect(seen).toEqual([['Label', [{ kind: 'mount' }]]]);
    act(() => root.unmount());
  });

  it('names the prop that moved, with both values', () => {
    expect(rerendered(<Label text="a" />, <Label text="b" />)).toEqual([
      ['Label', [{ kind: 'prop', name: 'text', before: 'a', after: 'b' }]],
    ]);
  });

  it('names a callback rebuilt on every render as a prop that moved', () => {
    const [[name, [cause]]] = rerendered(<Label text="a" onPick={() => {}} />, <Label text="a" onPick={() => {}} />) as [
      [string, RenderCause[]],
    ];
    expect([name, cause?.kind, cause?.kind === 'prop' && cause.name]).toEqual(['Label', 'prop', 'onPick']);
  });

  it('says the parent rendered when every input held, and a memo stops the render', () => {
    function Shell({ tick }: { tick: number }): ReactElement {
      return (
        <div data-tick={tick}>
          <Label text="same" />
          <Quiet />
        </div>
      );
    }
    expect(rerendered(<Shell tick={1} />, <Shell tick={2} />)).toEqual([
      ['Shell', [{ kind: 'prop', name: 'tick', before: 1, after: 2 }]],
      ['Label', [{ kind: 'parent' }]],
    ]);
  });

  it('names the context whose value moved', () => {
    const Inner = memo(Themed);
    expect(
      rerendered(
        <Theme.Provider value="light">
          <Inner />
        </Theme.Provider>,
        <Theme.Provider value="dark">
          <Inner />
        </Theme.Provider>,
      ),
    ).toEqual([['Themed', [{ kind: 'context', name: 'Theme', before: 'light', after: 'dark' }]]]);
  });

  it('names no context a render read for the first time, only the prop that made it read one', () => {
    function Sometimes({ read }: { read: boolean }): ReactElement {
      return <p>{read ? use(Theme) : 'none'}</p>;
    }
    expect(
      rerendered(
        <Theme.Provider value="dark">
          <Sometimes read={false} />
        </Theme.Provider>,
        <Theme.Provider value="dark">
          <Sometimes read />
        </Theme.Provider>,
      ),
    ).toEqual([['Sometimes', [{ kind: 'prop', name: 'read', before: false, after: true }]]]);
  });

  it('calls a context with no display name anonymous', () => {
    const Unnamed = createContext(0);
    function Reader(): ReactElement {
      return <p>{useContext(Unnamed)}</p>;
    }
    const Inner = memo(Reader);
    expect(
      rerendered(
        <Unnamed.Provider value={1}>
          <Inner />
        </Unnamed.Provider>,
        <Unnamed.Provider value={2}>
          <Inner />
        </Unnamed.Provider>,
      ),
    ).toEqual([['Reader', [{ kind: 'context', name: '(anonymous)', before: 1, after: 2 }]]]);
  });

  it('names the state cell that moved, by its hook call', () => {
    let open: () => void = () => {};
    function Toggle(): ReactElement {
      const [, setName] = useState('x');
      const [shown, setShown] = useState(false);
      open = () => setShown(true);
      void setName;
      return <span>{String(shown)}</span>;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Toggle />));
    seen.length = 0;
    act(() => open());
    expect(seen).toEqual([['Toggle', [{ kind: 'hook', hook: 'useState', index: 1, before: false, after: true }]]]);
    act(() => root.unmount());
  });

  it('leaves a memo whose deps moved out, since the render moved them', () => {
    function Priced({ amount }: { amount: number }): ReactElement {
      const label = useMemo(() => `$${amount}`, [amount]);
      return <span>{label}</span>;
    }
    expect(rerendered(<Priced amount={1} />, <Priced amount={2} />)).toEqual([
      ['Priced', [{ kind: 'prop', name: 'amount', before: 1, after: 2 }]],
    ]);
  });

  it("names a class component's state when setState moved it", () => {
    let open: () => void = () => {};
    class Drawer extends Component<object, { shown: boolean }> {
      override state = { shown: false };
      override componentDidMount(): void {
        open = () => this.setState({ shown: true });
      }
      override render(): ReactElement {
        return <span>{String(this.state.shown)}</span>;
      }
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Drawer />));
    seen.length = 0;
    act(() => open());
    expect(seen).toEqual([['Drawer', [{ kind: 'state', before: { shown: false }, after: { shown: true } }]]]);
    act(() => root.unmount());
  });

  it('says state was not read, rather than that it held, when the build kept no hook record', () => {
    const props = {};
    const before = { tag: 0, alternate: null, memoizedProps: props, memoizedState: { memoizedState: 1, next: null } };
    const after = { ...before, alternate: before, memoizedState: { memoizedState: 2, next: null } };
    expect(renderCausesOf(after as unknown as Fiber)).toEqual([{ kind: 'unread' }]);
  });

  it('says state was not read past a hook the reader does not know, beside what it could read', () => {
    const shape = (value: number) => ({ memoizedState: value, next: null });
    const before = { tag: 0, alternate: null, memoizedProps: { n: 1 }, memoizedState: shape(1), _debugHookTypes: ['useSomethingNew'] };
    const after = { ...before, alternate: before, memoizedProps: { n: 2 }, memoizedState: shape(2) };
    expect(renderCausesOf(after as unknown as Fiber)).toEqual([
      { kind: 'prop', name: 'n', before: 1, after: 2 },
      { kind: 'unread', hook: 'useSomethingNew' },
    ]);
  });

  it('says the same props object and no input moved as unseen', () => {
    const props = {};
    const before = { tag: 0, alternate: null, memoizedProps: props, memoizedState: null, _debugHookTypes: null };
    const after = { ...before, alternate: before };
    expect(renderCausesOf(after as unknown as Fiber)).toEqual([{ kind: 'unseen' }]);
  });
});
