import { test, expect } from './journey.mjs';

test('the home page links to search and cart', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tea shop' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search.html');
  await expect(page.getByRole('link', { name: 'Cart' })).toHaveAttribute('href', '/cart.html');
});
