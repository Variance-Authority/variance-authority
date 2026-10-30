// @vitest-environment jsdom
//
// The causes a test story most often meets in React 19 that its parent and its
// own inputs do not explain: which component started a commit, a boundary that
// came back from its fallback, a tree rendered while hidden, a callback made
// anew each render, and a component the React Compiler memoized.

import { Activity, Suspense, act, memo, use, useState, type ReactElement } from 'react';
import { c } from 'react/compiler-runtime';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const NOTE = Symbol.for('variance-authority.story.note');
const realm = globalThis as { [NOTE]?: unknown };
const lines: string[] = [];
const shownAs = (value: unknown): unknown => (typeof value === 'function' ? 'fn' : typeof value === 'object' && value !== null ? 'obj' : value);
realm[NOTE] = (strings: readonly string[], ...values: unknown[]): void => {
  lines.push(strings.reduce((line, part, index) => line + String(shownAs(values[index - 1])) + part));
};

await import('./story.js');
const { createRoot } = await import('react-dom/client');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  lines.length = 0;
});

afterAll(() => {
  delete realm[NOTE];
});

function Leaf(): ReactElement {
  return <i />;
}

let flip: () => void = () => {};
function Toggle(): ReactElement {
  const [open, setOpen] = useState(false);
  flip = () => setOpen((was) => !was);
  return <div>{open ? 'open' : <Leaf />}</div>;
}

let tick: () => void = () => {};
function Ticker(): ReactElement {
  const [count, setCount] = useState(0);
  if (count === 0) tick = () => setCount(1);
  return <i>{count}</i>;
}

describe('which component the React story setup says started a commit', () => {
  it('a keyed one with its key, so two rows of one list read apart', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<div>{['a', 'b'].map((key) => <Ticker key={key} />)}</div>));
    lines.length = 0;
    act(() => tick());
    act(() => root.unmount());

    expect(lines[0]).toBe('commit — 1 rendered, started by Ticker key="b"');
  });

  it('the one whose update React committed, and none for a commit nothing updated, as a mount', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Toggle />));
    act(() => flip());
    act(() => root.unmount());

    expect(lines).toEqual([
      'commit — 2 rendered',
      'rendered Toggle — mounted with Leaf',
      'commit — 1 rendered, started by Toggle',
      'rendered Toggle — useState #0 false → true',
      'commit — 0 rendered',
    ]);
  });
});

let held: (value: number) => void = () => {};
function Holder(): ReactElement {
  const [count, setCount] = useState(0);
  held = setCount;
  return <i>{count}</i>;
}
const Kept = memo(Holder);

let bump: () => void = () => {};
function Shelf(): ReactElement {
  const [, setTick] = useState(0);
  bump = () => setTick((tick) => tick + 1);
  return (
    <div>
      <Kept />
      <Holder />
    </div>
  );
}

describe('what the React story setup reads a render against', () => {
  it('the render before it, however many commits a memo skipped the component for', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Shelf />));
    // Both holders set state once, so each side of their alternate pair has held a count.
    act(() => held(1));
    act(() => bump());
    act(() => bump());
    act(() => bump());
    lines.length = 0;
    act(() => bump());
    act(() => root.unmount());

    // `Kept` was skipped by its memo: it did no work, so it says no line.
    expect(lines.filter((line) => line.startsWith('rendered '))).toEqual(['rendered Shelf — useState #0 3 → 4', 'rendered Holder — its parent rendered']);
  });
});

/** A promise `use` reads at once once it is settled, the status fields React itself writes on one it has met. */
function deferred<T>(): { readonly read: Promise<T>; readonly settle: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const read = new Promise<T>((done) => {
    resolve = done;
  });
  return {
    read,
    settle: (value) => {
      Object.assign(read, { status: 'fulfilled', value });
      resolve(value);
    },
  };
}

// A cache a component reads by id, as a data library holds it: the promise is no input of the component.
let price = deferred<number>();
price.settle(1);
function Price({ id }: { id: number }): ReactElement {
  return <i>{use(price.read) + id}</i>;
}

let refresh: () => void = () => {};
function Shop(): ReactElement {
  const [, setVersion] = useState(0);
  refresh = () => setVersion((version) => version + 1);
  return (
    <Suspense fallback={<b />}>
      <Price id={1} />
    </Suspense>
  );
}

describe('why the React story setup says a component rendered after it suspended', () => {
  it('the boundary above it came back from its fallback, not a parent that did not render', async () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Shop />));
    const next = deferred<number>();
    price = next;
    // React leaves the retry of a boundary that suspended inside an `act` scope to an awaited one.
    await act(async () => refresh());
    lines.length = 0;
    await act(async () => next.settle(2));
    act(() => root.unmount());

    expect(lines.slice(0, 2)).toEqual(['commit — 1 rendered', 'rendered Price — the Suspense boundary above it came back from its fallback']);
  });

  // A retry inside `startTransition` keeps the content on screen and shows no
  // fallback, so the boundary reads resolved on both sides and the line says
  // `its parent rendered`.
  it.todo('the boundary above it retried in a transition, which showed no fallback — needs the retry lane the commit ran in');
});

let reopen: () => void = () => {};
function Panel(): ReactElement {
  return <i />;
}
function Tabs(): ReactElement {
  const [mode, setMode] = useState<'hidden' | 'visible'>('hidden');
  reopen = () => setMode('visible');
  return (
    <Activity mode={mode}>
      <Panel />
    </Activity>
  );
}

describe('how the React story setup says a component rendered inside a hidden Activity', () => {
  it('as hidden, so a tree React rendered ahead of showing it does not read as one on screen', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Tabs />));
    act(() => reopen());
    act(() => root.unmount());

    expect(lines.filter((line) => line.startsWith('rendered '))).toEqual([
      'rendered Tabs — mounted',
      'rendered Panel (hidden) — mounted',
      'rendered Tabs — useState #0 hidden → visible',
      'rendered Panel — its parent rendered',
    ]);
  });
});

function Row({ onPick, style }: { onPick: () => void; style: { readonly color: string } }): ReactElement {
  return <i onClick={onPick} style={style} />;
}
let rerender: () => void = () => {};
function List(): ReactElement {
  const [, setTick] = useState(0);
  rerender = () => setTick((tick) => tick + 1);
  return <Row onPick={() => {}} style={{ color: 'red' }} />;
}

describe('how the React story setup says a prop given a new identity each render', () => {
  it('a function from the same source and an object equal in value, the props a `useCallback` or a `useMemo` would keep', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<List />));
    lines.length = 0;
    act(() => rerender());
    act(() => root.unmount());

    expect(lines.filter((line) => line.startsWith('rendered Row'))).toEqual(['rendered Row — onPick fn → fn (same source), style obj → obj (equal value)']);
  });
});

let turn = 0;
function Mixed(): ReactElement {
  const [, setTick] = useState(0);
  rerender = () => setTick((tick) => tick + 1);
  turn += 1;
  const pick = turn % 2 === 0 ? () => turn : () => -turn;
  return <Row onPick={turn % 2 === 0 ? pick : pick.bind(null)} style={{ color: turn % 2 === 0 ? 'red' : 'blue' }} />;
}

describe('how the React story setup says a prop that moved in kind', () => {
  it('as moved alone: a function from other source, a bound function, and an object unequal in value', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Mixed />));
    lines.length = 0;
    act(() => rerender());
    act(() => rerender());
    act(() => root.unmount());

    expect(lines.filter((line) => line.startsWith('rendered Row'))).toEqual(['rendered Row — onPick fn → fn, style obj → obj', 'rendered Row — onPick fn → fn, style obj → obj']);
  });
});

function Bound(): ReactElement {
  const [, setTick] = useState(0);
  rerender = () => setTick((tick) => tick + 1);
  return <Row onPick={Leaf.bind(null) as never} style={{ color: 'red' }} />;
}

function Sink({ value }: { value: object }): ReactElement {
  return <i data-kind={typeof value} />;
}

let revoke: () => void = () => {};
function Guarded(): ReactElement {
  const [, setTick] = useState(0);
  rerender = () => setTick((tick) => tick + 1);
  const guard = Proxy.revocable({ color: 'red' }, {});
  revoke = guard.revoke;
  return (
    <>
      <Sink value={guard.proxy} />
      <Sink
        value={{
          get color(): string {
            throw new Error('read');
          },
        }}
      />
      <Leaf />
    </>
  );
}

describe('what the React story setup says of a value it cannot compare safely', () => {
  it('two bound functions as moved alone, since every bound function prints the same', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Bound />));
    lines.length = 0;
    act(() => rerender());
    act(() => root.unmount());

    expect(lines.filter((line) => line.startsWith('rendered Row'))).toEqual(['rendered Row — onPick fn → fn, style obj → obj (equal value)']);
  });

  it('a revoked proxy and a getter as moved alone, run by no read, and every line after them still said', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Guarded />));
    revoke();
    lines.length = 0;
    act(() => rerender());
    act(() => root.unmount());

    expect(lines.slice(0, 5)).toEqual(['commit — 4 rendered, started by Guarded', 'rendered Guarded — useState #0 0 → 1', 'rendered Sink — value obj → obj', 'rendered Sink — value obj → obj', 'rendered Leaf — its parent rendered']);
  });
});

let add: () => void = () => {};
// What the React Compiler emits for a component holding one state: a memo cache, then the state.
function Compiled(): ReactElement {
  const $ = c(2);
  const [count, setCount] = useState(0);
  add = () => setCount((was) => was + 1);
  let shown: ReactElement;
  if ($[0] !== count) {
    shown = <i>{count}</i>;
    $[0] = count;
    $[1] = shown;
  } else {
    shown = $[1] as ReactElement;
  }
  return shown;
}

describe('why the React story setup says a compiled component rendered', () => {
  it('the state that moved, counted past the memo cache the compiler put first, which holds no state cell', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Compiled />));
    lines.length = 0;
    act(() => add());
    act(() => root.unmount());

    expect(lines[1]).toBe('rendered Compiled — useState #0 0 → 1');
  });
});
