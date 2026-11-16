// @vitest-environment jsdom

import { expect, it } from 'vitest';

// Line 9 adds a node; line 10 finds it already there and changes nothing.
it('adds a node and reads it', () => {
  const button = document.createElement('button');
  button.textContent = 'Open';
  document.body.append(button);
  expect(document.querySelector('button')?.textContent).toBe('Open');
});
