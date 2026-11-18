// Storybook's manager, an app this repository did not write and did not change:
// the build `cases/storybook-case` makes, served as files. It announces nothing
// to a test, and its search ends in one of two places.
import { expect, test, type Page } from '@playwright/test';
import { action } from '@variance-authority/page-broker';

const find = action(
  'find',
  {
    // A match is marked. An option without a mark is one recently opened, shown
    // while the box is empty.
    found: (page) => page.getByRole('option').filter({ has: page.locator('mark') }).first(),
    nothing: (page) => page.getByText('No components found'),
  },
  async (page, words: string) => {
    await page.getByRole('searchbox').fill(words);
  },
);

/** Opening one found story. An outcome's recogniser is not given the action's arguments, so the story is named here. */
const open = (story: string) =>
  action(
    'open',
    { story: (page) => page.locator(`[data-item-id="${story}"][data-selected="true"]`) },
    async (page) => {
      await page.locator(`[role="option"][data-id="${story}"]`).click();
    },
  );

async function manager(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('searchbox').waitFor();
}

test('a search for a story that exists reaches its matches', async ({ page }) => {
  await manager(page);

  const reached = await find(page, 'card');

  expect(reached.outcome).toBe('found');
  expect(await reached.at!.innerText()).toContain('Card');
});

test('a search for nothing that exists reaches the empty answer', async ({ page }) => {
  await manager(page);

  await expect(find(page, 'zzzz')).resolves.toMatchObject({ outcome: 'nothing' });
});

test('a test that insisted on matches hears that there were none', async ({ page }) => {
  await manager(page);

  await expect(find(page, 'zzzz').to('found')).rejects.toThrow('find: expected found, reached nothing');
});

test('a found story, opened, is the one selected and shown', async ({ page }) => {
  await manager(page);
  await find(page, 'card').to('found');

  await open('case-surface--card-with-actions')(page).to('story');

  expect(new URL(page.url()).searchParams.get('path')).toBe('/story/case-surface--card-with-actions');
});
