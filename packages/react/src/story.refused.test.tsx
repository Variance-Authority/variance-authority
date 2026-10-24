// @vitest-environment jsdom
//
// A story is listening, but `react-dom` loaded before the setup file did and has
// mounted, so React looked for a tap long ago and will never announce a commit.

import { act } from 'react';
import { afterAll, describe, expect, it } from 'vitest';

const NOTE = Symbol.for('variance-authority.story.note');
const realm = globalThis as { [NOTE]?: unknown };
const lines: string[] = [];
realm[NOTE] = (strings: readonly string[]): void => {
  lines.push(strings.join(''));
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const container = document.createElement('div');
document.body.append(container);
act(() => createRoot(container).render(<i />));
await import('./story.js');

afterAll(() => {
  delete realm[NOTE];
});

describe('the React story setup when React will not announce commits', () => {
  it('says the renders are not read, and why, rather than saying nothing', () => {
    expect(lines).toEqual(['renders not read: react-already-loaded']);
  });

  it('leaves Eyes its commit line, since no render line will say the commit', () => {
    expect((globalThis as Record<symbol, unknown>)[Symbol.for('variance-authority.react.story.tapped')]).toBeUndefined();
  });
});
