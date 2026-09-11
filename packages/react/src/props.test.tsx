// @vitest-environment jsdom
//
// The tap runs at module scope and `react-dom` is imported dynamically beneath
// it, for the reason `commits.test.tsx` states: React only fills
// `memoizedUpdaters` while it believes DevTools is present, so the hook has to
// exist before the renderer's module body runs. Installed late, the updater half
// of the comparison below is empty and the file asserts nothing — which is why
// `attached` is checked inside the test rather than assumed.

import { describe, expect, it } from 'vitest';
import { provenanceOf, tapCommits } from './index.js';

const installed = tapCommits();

const { createRoot } = await import('react-dom/client');
const { createElement: h, act, useState } = await import('react');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the props digest both records are joined on', () => {
  it('agrees between an owner frame and a commit updater frame for one instance', async () => {
    let bump!: () => void;

    function Counter() {
      const [value, setValue] = useState(0);
      bump = () => setValue((current) => current + 1);
      return h('span', { id: 'count' }, String(value));
    }
    function Panel(props: { label: string; tone: string; children?: unknown }) {
      return h('section', null, props.children as never);
    }
    function Shell() {
      return h(Panel, { label: 'checkout', tone: 'quiet' }, h(Counter, null));
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const tap = tapCommits();

    await act(async () => {
      root.render(h(Shell, null));
    });
    await act(async () => {
      bump();
    });

    // Zero commits and no tap look alike from here, and only one of them would
    // make the equality below vacuous.
    expect(installed.attached).toBe(true);

    const commit = tap.commits().at(-1);
    expect(commit?.components).toEqual(['Counter']);

    const updater = commit?.updaters?.[0];
    const owners = provenanceOf(container.querySelector('#count') as Node)?.owners;

    // Both sides have to be describing the same three boundaries before their
    // digests can be said to agree about anything.
    expect(updater?.path.map((frame) => frame.name)).toEqual(['Counter', 'Panel', 'Shell']);
    expect(owners?.map((frame) => frame.name)).toEqual(['Counter', 'Panel', 'Shell']);

    // The comparison `variance_distill` actually performs: walk the
    // common suffix of an updater's path and an addressed component path, and
    // require name *and* digest equality at every frame. Frame by frame, one
    // projection or the answer silently degrades to "outside addressed component
    // paths" for everything.
    expect(updater?.path.map((frame) => frame.propsDigest)).toEqual(
      owners?.map((frame) => frame.propsDigest),
    );

    // A projection that returned `{}` for every boundary would satisfy that
    // equality and still destroy the join, so the digests must separate a
    // boundary carrying props from one carrying none.
    expect(owners?.[1]?.propsDigest).not.toBe(owners?.[2]?.propsDigest);

    tap.stop();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
