// @vitest-environment jsdom

import { expect, it } from 'vitest';
import './clear-page.js';

// Line 11 adds a node; line 12 finds it already there and changes nothing.
// The page's cleanup runs after each case, and changes no line of it.
it('adds a node and reads it', () => {
  const button = document.createElement('button');
  button.textContent = 'Open';
  document.body.append(button);
  expect(document.querySelector('button')?.textContent).toBe('Open');
});

// Line 18 waits while the timer line 17 set adds a node; line 19 reads it.
it('waits for a node', async () => {
  setTimeout(() => document.body.append(document.createElement('i')), 5);
  await new Promise((done) => setTimeout(done, 20));
  expect(document.querySelector('i')).toBeTruthy();
});
