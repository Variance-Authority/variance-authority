// @vitest-environment jsdom
//
// The setup file hears React's commits, so it is evaluated before react-dom is, as a story run has it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import './story.js';

const { act, createElement: h, Suspense, useState } = await import('react');
const { createRoot } = await import('react-dom/client');

type Root = ReturnType<typeof createRoot>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMMIT = Symbol.for('variance-authority.story.page-commit');
const OWNER = Symbol.for('variance-authority.story.page-owner');
const NOTE = Symbol.for('variance-authority.story.note');
const realm = globalThis as { [COMMIT]?: () => void; [OWNER]?: (node: Node) => string | undefined; [NOTE]?: (text: string) => void };

let container: HTMLDivElement;
let root: Root;
let observer: MutationObserver;
// The nodes each commit added, as the page watch takes them when React says it committed.
let commits: string[][];

beforeEach(() => {
  commits = [];
  container = document.body.appendChild(document.createElement('div'));
  observer = new MutationObserver(() => undefined);
  observer.observe(document, { childList: true, subtree: true });
  realm[COMMIT] = () =>
    commits.push(observer.takeRecords().flatMap((record) => [...record.addedNodes].map((node) => node.nodeName.toLowerCase())));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  observer.disconnect();
  delete realm[COMMIT];
  delete realm[NOTE];
});

function Dialog() {
  return h('div', { role: 'dialog' }, h('button', null, 'Yes'));
}

let open: () => void;
function App() {
  const [shown, show] = useState(false);
  open = () => show(true);
  return h('main', null, shown ? h(Dialog) : null);
}

describe('what React tells the story about the page', () => {
  it('says each commit once React has written it, so what a commit changed is taken under it, and nothing between commits', async () => {
    await act(async () => root.render(h(App)));
    await act(async () => open());
    document.body.append(document.createElement('aside'));

    expect(commits).toEqual([['main'], ['div']]);
    expect(observer.takeRecords().flatMap((record) => [...record.addedNodes].map((node) => node.nodeName))).toEqual(['ASIDE']);
  });

  it('names the component that rendered a node, and nothing for a node React did not render', async () => {
    await act(async () => root.render(h(App)));
    await act(async () => open());

    expect(realm[OWNER]?.(container.querySelector('button')!)).toBe('Dialog');
    expect(realm[OWNER]?.(container.querySelector('main')!)).toBe('App');
    expect(realm[OWNER]?.(container)).toBeUndefined();
  });

  it('tells the story at the commit a boundary shows its fallback, through the channel the realm holds then', async () => {
    const said: string[] = [];
    realm[NOTE] = (text) => said.push(text);
    const pending = new Promise<never>(() => undefined);
    function Waits(): never {
      throw pending;
    }
    await act(async () => root.render(h(Suspense, { fallback: h('p', null, 'Loading') }, h(Waits))));

    expect(said).toEqual(['suspense Suspense shows its fallback']);
  });
});
