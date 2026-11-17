// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { CheckoutPage } from '../src/checkout.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('waits on the cart', async () => {
  const host = document.body.appendChild(document.createElement('div'));
  let settle = (_: string): void => {};
  const cart = new Promise<string>((resolve) => (settle = resolve));
  await act(async () => createRoot(host).render(<CheckoutPage cart={cart} />));
  expect(host.textContent).toBe('loading');
  await act(async () => settle('3 items'));
  expect(host.textContent).toBe('3 items');
});

it('shows the cart', async () => {
  const host = document.body.appendChild(document.createElement('div'));
  let arrive = (_: string): void => {};
  const cart = new Promise<string>((resolve) => (arrive = resolve));
  await act(async () => createRoot(host).render(<CheckoutPage cart={cart} />));
  if (process.env['CART_ARRIVES'] === '1') await act(async () => arrive('3 items'));
  expect(host.textContent).toContain('3 items');
});
