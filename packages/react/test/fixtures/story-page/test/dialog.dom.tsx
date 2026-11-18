// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { App } from '../src/dialog.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('opens the dialog', () => {
  const host = document.body.appendChild(document.createElement('div'));
  act(() => createRoot(host).render(<App />));
  act(() => host.querySelector('button')!.click());
  document.body.append(document.createElement('aside'));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
});
