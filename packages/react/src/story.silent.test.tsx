// @vitest-environment jsdom
//
// The setup file in a realm no story is recording: there is no channel when it
// runs, so it taps nothing and a test pays nothing.

import { describe, expect, it } from 'vitest';

await import('./story.js');

describe('the React story setup with no story listening', () => {
  it('installs no commit tap', () => {
    expect(Object.hasOwn(globalThis, '__REACT_DEVTOOLS_GLOBAL_HOOK__')).toBe(false);
    expect(Object.hasOwn(globalThis, Symbol.for('variance-authority.react.story.tapped'))).toBe(false);
  });
});
