// @vitest-environment jsdom
//
// The setup file as a story realm loads it: the channel is there first, and
// `react-dom` is imported after it, so the tap it makes hears every commit.

import { act, Component, Fragment, createContext, createElement, createRef, forwardRef, memo, useContext, useState, type ReactElement } from 'react';
import { afterAll, describe, expect, it, vi } from 'vitest';

const NOTE = Symbol.for('variance-authority.story.note');
const realm = globalThis as { [NOTE]?: unknown };
const lines: string[] = [];
const renders = (): string[] => lines.filter((line) => line.startsWith('rendered '));
const shownAs = (value: unknown): unknown => (typeof value === 'function' ? 'fn' : typeof value === 'object' && value !== null ? 'obj' : value);
// The tap's template channel, with each value shown by its kind alone.
realm[NOTE] = (strings: readonly string[], ...values: unknown[]): void => {
  lines.push(strings.reduce((line, part, index) => line + String(shownAs(values[index - 1])) + part));
};

await import('./story.js');
// A realm that runs its setup files again for the next test file, as Vitest does without isolation.
vi.resetModules();
const { reactKind } = await import('./story.js');
const { createRoot } = await import('react-dom/client');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterAll(() => {
  delete realm[NOTE];
});

function Leaf(): ReactElement {
  return <i />;
}

function Branch({ onPick }: { onPick: () => void }): ReactElement {
  return (
    <b onClick={onPick}>
      <Leaf />
    </b>
  );
}

let flip: () => void = () => {};
function Tree(): ReactElement {
  const [open, setOpen] = useState(false);
  flip = () => setOpen(true);
  return <div>{open ? <Branch onPick={() => {}} /> : <Leaf />}</div>;
}

describe('the React story setup', () => {
  it('says where each commit starts and how many rendered in it, none among them, a mounted subtree once at its top with each component that mounted below it, a render once however often the setup ran, and values through the channel', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Tree />));
    act(() => flip());
    act(() => root.unmount());

    expect(lines).toEqual([
      'commit — 2 rendered',
      'rendered Tree — mounted with Leaf',
      'commit — 3 rendered, started by Tree',
      'rendered Tree — useState #0 false → true',
      // Branch mounts under a Tree that updated, so it is the top of what mounted, and Leaf mounted with it.
      'rendered Branch — mounted with Leaf',
      // The unmount commits with no component rendering, and says so, as a commit of host elements alone does.
      'commit — 0 rendered',
    ]);
  });
});

const Mode = createContext('light');
Mode.displayName = 'Mode';

class Counter extends Component<{ label: string; size: number }, { count: number }> {
  override state = { count: 0 };
  override render(): ReactElement {
    return <i>{this.props.label}</i>;
  }
}

function Themed(): ReactElement {
  return <u>{useContext(Mode)}</u>;
}

describe('why the React story setup says a component rendered', () => {
  it('a class state, a render nothing it reads asked for, a context by its name, and each prop that moved', () => {
    const counter = createRef<Counter>();
    const root = createRoot(document.createElement('div'));
    const tree = (mode: string, label: string, size: number): ReactElement => (
      <Mode.Provider value={mode}>
        <Counter ref={counter} label={label} size={size} />
        <Themed />
      </Mode.Provider>
    );
    act(() => root.render(tree('light', 'a', 1)));
    lines.length = 0;
    act(() => counter.current?.setState({ count: 1 }));
    act(() => counter.current?.forceUpdate());
    act(() => root.render(tree('dark', 'b', 2)));
    act(() => root.unmount());

    expect(renders()).toEqual([
      'rendered Counter — state obj → obj',
      'rendered Counter — no input it reads moved',
      'rendered Counter — label a → b, size 1 → 2',
      'rendered Themed — Mode light → dark',
    ]);
  });
});

function Row({ picked }: { picked: boolean }): ReactElement {
  return <li>{String(picked)}</li>;
}

describe('which component the React story setup says rendered', () => {
  it('a keyed one by its key, so two tests that render different rows of a list read apart', () => {
    const root = createRoot(document.createElement('div'));
    const list = (picked: string): ReactElement => (
      <ul>
        {['a', 'b'].map((id) => (
          <Row key={id} picked={id === picked} />
        ))}
      </ul>
    );
    act(() => root.render(list('')));
    lines.length = 0;
    act(() => root.render(list('b')));
    act(() => root.unmount());

    expect(renders()).toEqual(['rendered Row key="a" — its parent rendered', 'rendered Row key="b" — picked false → true']);
  });

  it('a keyed one by the key on the memo or fragment that wraps it', () => {
    const Picked = memo(Row, (before, after) => before.picked === after.picked);
    const root = createRoot(document.createElement('div'));
    const list = (picked: string): ReactElement => (
      <ul>
        <Picked key="a" picked={picked === 'a'} />
        <Fragment key="b">
          <Row picked={picked === 'b'} />
        </Fragment>
      </ul>
    );
    act(() => root.render(list('')));
    lines.length = 0;
    act(() => root.render(list('ab')));
    act(() => root.render(list('a')));
    act(() => root.unmount());

    expect(renders()).toEqual([
      'rendered Row key="b" — its parent rendered',
      'rendered Row key="a" — picked false → true',
      'rendered Row key="b" — its parent rendered',
    ]);
  });
});

describe('how the React story setup says a large mount', () => {
  it('over as many lines as the names below its top need, each short enough that the story keeps all of it', () => {
    const names = Array.from({ length: 40 }, (_, at) => {
      const Named = (): ReactElement => <i />;
      Object.defineProperty(Named, 'name', { value: `Component${String(at).padStart(2, '0')}` });
      return Named;
    });
    const Shell = (): ReactElement => <>{names.map((Named) => <Named key={Named.name} />)}</>;
    const root = createRoot(document.createElement('div'));
    lines.length = 0;
    act(() => root.render(<Shell />));
    act(() => root.unmount());

    const mounts = renders();
    expect(mounts.length).toBeGreaterThan(1);
    expect(mounts.every((line) => line.startsWith('rendered Shell — mounted with ') && line.length <= 240)).toBe(true);
    expect(mounts.flatMap((line) => line.slice('rendered Shell — mounted with '.length).split(', '))).toEqual(names.map((Named) => `${Named.name} key="${Named.name}"`));
  });
});

describe('which key the React story setup reads through a fragment', () => {
  it('none for components that share one keyed fragment, since its key tells none of them apart', () => {
    const root = createRoot(document.createElement('div'));
    const pair = (picked: boolean): ReactElement => (
      <Fragment key="b">
        <Row picked={picked} />
        <Leaf />
      </Fragment>
    );
    act(() => root.render(pair(false)));
    lines.length = 0;
    act(() => root.render(pair(true)));
    act(() => root.unmount());

    expect(renders()).toEqual(['rendered Row — picked false → true', 'rendered Leaf — its parent rendered']);
  });
});

describe('what a story calls a React object', () => {
  it('the kind React marks it with', () => {
    const Theme = createContext('light');
    const Panel = (): null => null;

    expect(reactKind(Theme)).toBe('react.context');
    expect(reactKind(memo(Panel))).toBe('react.memo');
    expect(reactKind(forwardRef(Panel))).toBe('react.forward_ref');
    expect(reactKind(createElement(Panel))).toBe('react.transitional.element');
  });

  it('nothing for an object React did not mark', () => {
    expect(reactKind({})).toBeUndefined();
    expect(reactKind({ $$typeof: Symbol.for('other.kind') })).toBeUndefined();
    expect(reactKind(() => null)).toBeUndefined();
  });
});
