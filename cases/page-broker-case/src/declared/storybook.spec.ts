// Storybook's manager, an app this repository did not write and did not change:
// the build `cases/storybook-case` makes, served as files. It announces nothing
// to a test, and its search ends in one of two places.
import { expect, test, type Page } from '@playwright/test';
import { broker, leads } from '@variance-authority/page-broker';
import { surface } from '@variance-authority/page-broker/playwright';

/** The story selected in the sidebar, which a search's list hides while it is shown. */
const Story = broker('story', { probe: { css: '[data-item-id][data-selected="true"]' } });

/** The stories a search matched. An option without a mark is one recently opened, shown while the box is empty. */
const Matches = broker('matches', {
  probe: { css: '[role="option"]:has(mark)' },
  actions: {
    open: leads({ story: Story }, (on, id: string) => on.click({ css: `[role="option"][data-id="${id}"]` })),
  },
});

const NoMatches = broker('noMatches', { probe: { text: 'No components found' } });

const Manager = broker('manager', {
  probe: { role: 'searchbox' },
  actions: {
    find: leads({ found: Matches, nothing: NoMatches }, (on, words: string) => on.fill({ role: 'searchbox' }, words)),
  },
});

/** An adopter's suite: Playwright's own page per test, and a navigation to start from. */
async function manager(page: Page) {
  await page.goto('/');
  await page.getByRole('searchbox').waitFor();
  return Manager.on(surface(page));
}

test('a search for a story that exists reaches its matches', async ({ page }) => {
  const reached = await (await manager(page)).find('card');

  expect(reached.outcome).toBe('found');
  expect(await reached.at.root.innerText()).toContain('Card');
});

test('a search for nothing that exists reaches the empty answer', async ({ page }) => {
  await expect((await manager(page)).find('zzzz')).resolves.toMatchObject({ outcome: 'nothing' });
});

test('a test that insisted on matches hears that there were none', async ({ page }) => {
  await expect((await manager(page)).find('zzzz').to('found')).rejects.toThrow(
    'manager.find: expected found, reached nothing',
  );
});

test('a found story, opened, is the one selected and shown', async ({ page }) => {
  const matches = await (await manager(page)).find('card').to('found');

  const story = await matches.open('case-surface--card-with-actions').to('story');

  await expect(story.root).toHaveAttribute('data-item-id', 'case-surface--card-with-actions');
  expect(new URL(page.url()).searchParams.get('path')).toBe('/story/case-surface--card-with-actions');
});
