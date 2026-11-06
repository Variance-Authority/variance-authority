import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Cart } from '../src/cart.js';

it('opens the summary on a click', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  act(() => createRoot(host).render(<Cart />));
  act(() => host.querySelector('button')!.click());
  expect(host.textContent).toBe('cartopen');
});

it('renders the cart again unchanged', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(<Cart />));
  act(() => root.render(<Cart />));
  expect(host.textContent).toBe('cartclosed');
});
