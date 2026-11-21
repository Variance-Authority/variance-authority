// Storybook's manager, an app this repository did not write and did not change:
// the build `cases/storybook-case` makes, served as files. It announces nothing
// to a test, and its search ends in one of two places.
import { expect, test, type Page } from '@playwright/test';
import { action, region } from '@variance-authority/page-broker';
import { surface } from '@variance-authority/page-broker/playwright';

const search = region('search', { role: 'searchbox' });
// A match is marked. An option without a mark is one recently opened, shown
// while the box is empty.
const found = region('found', { css: '[role="option"]:has(mark)' });
const nothing = region('nothing', { text: 'No components found' });

const find = action('find', { from: search, to: { found, nothing } }, (on, words: string) =>
  on.fill({ role: 'searchbox' }, words),
);

/** Opening one found story. A region is not given the action's arguments, so the story is named here. */
const open = (story: string) =>
  action(
    'open',
    { from: found, to: { story: region('story', { css: `[data-item-id="${story}"][data-selected="true"]` }) } },
    (on) => on.click({ css: `[role="option"][data-id="${story}"]` }),
  );

/** An adopter's suite: Playwright's own page per test, and a navigation to start from. */
async function manager(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('searchbox').waitFor();
}

test('a search for a story that exists reaches its matches', async ({ page }) => {
  await manager(page);

  const reached = await find(surface(page), 'card');

  expect(reached.outcome).toBe('found');
  expect(await reached.at!.innerText()).toContain('Card');
});

test('a search for nothing that exists reaches the empty answer', async ({ page }) => {
  await manager(page);

  await expect(find(surface(page), 'zzzz')).resolves.toMatchObject({ outcome: 'nothing' });
});

test('a test that insisted on matches hears that there were none', async ({ page }) => {
  await manager(page);

  await expect(find(surface(page), 'zzzz').to('found')).rejects.toThrow('find: expected found, reached nothing');
});

test('a found story, opened, is the one selected and shown', async ({ page }) => {
  await manager(page);
  await find(surface(page), 'card').to('found');

  await open('case-surface--card-with-actions')(surface(page)).to('story');

  expect(new URL(page.url()).searchParams.get('path')).toBe('/story/case-surface--card-with-actions');
});
