// @vitest-environment jsdom
//
// The setup file as a story realm loads it: the channel is there first, and
// `react-dom` is imported after it, so the tap it makes hears every commit.

import { act, createContext, createElement, forwardRef, memo, useState, type ReactElement } from 'react';
import { afterAll, describe, expect, it, vi } from 'vitest';

const NOTE = Symbol.for('variance-authority.story.note');
const realm = globalThis as { [NOTE]?: unknown };
const lines: string[] = [];
// The tap's template channel, with each value shown by its kind alone.
realm[NOTE] = (strings: readonly string[], ...values: unknown[]): void => {
  lines.push(strings.reduce((line, part, index) => line + String(typeof values[index - 1] === 'function' ? 'fn' : values[index - 1]) + part));
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
  it('says a mounted subtree once at its top, a render once however often the setup ran, and values through the channel', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<Tree />));
    act(() => flip());
    act(() => root.unmount());

    expect(lines).toEqual([
      'rendered Tree — mounted',
      'rendered Tree — useState #0 false → true',
      // Branch mounts under a Tree that updated, so it is the top of what mounted; Leaf under it is not said.
      'rendered Branch — mounted',
    ]);
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
