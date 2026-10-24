// @vitest-environment jsdom
//
// Arranged as a runner setup file arranges it: the tap exists before
// `react-dom` runs its module body, so `react-dom/client` is imported below it.

import { act, createContext, memo, useContext, useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { tapCommits } from './commits.js';
import { fiberComponentName } from './names.js';
import { causesOf, type RenderCause } from './renders.js';

const seen: [string, readonly RenderCause[]][] = [];
tapCommits({ onRender: (fiber) => seen.push([fiberComponentName(fiber), causesOf(fiber)]) });

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
});
