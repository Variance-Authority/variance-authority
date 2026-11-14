import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/themed.js';

it('shows the theme it was given', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  act(() => createRoot(host).render(<App theme={{ name: 'dark' }} />));
  expect(host.textContent).toBe('dark');
});
