// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { capture, writeCapture } from '@variance-authority/unit-test';
import { badge } from '../src/badge.js';

// Media queries are resolved against this here, in this process, because the
// renderer that paints the capture later never sees this DOM.
const VIEWPORT = { width: 320, height: 120, deviceScaleFactor: 1, colorScheme: 'light' };

async function watch(subject, element) {
  document.body.replaceChildren(element);
  await writeCapture('.variance/captures', await capture(element, { subject, viewport: VIEWPORT }));
}

test('a neutral badge', async () => {
  const element = badge('Draft');

  // Your existing assertions stay. The capture is one more line, not a rewrite.
  expect(element.textContent).toBe('Draft');

  await watch('badge/neutral', element);
});

test('an urgent badge', async () => {
  const element = badge('Overdue', 'urgent');
  expect(element.textContent).toBe('Overdue');

  await watch('badge/urgent', element);
});
