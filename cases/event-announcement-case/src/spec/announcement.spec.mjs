import { expect, test as base } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';

const test = base.extend(varianceFixtures);

// `timeout: 0` throughout: the screen is asked once, never polled. Anything that
// passes here passed because the decision was announced, not because a retry
// eventually caught up with it.

test('the branch that draws a modal is assertable on the first run', async ({ page, events }) => {
  await page.goto('/?show=yes');
  await events.happened('checkout', 'upsell-modal', 'decided');
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 0 });
});

test('the branch that draws nothing is assertable too', async ({ page, events }) => {
  await page.goto('/?show=no');
  await events.happened('checkout', 'upsell-modal', 'decided');
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 0 });
});

test('without the announcement the negative passes for the wrong reason', async ({ page }) => {
  // The modal is coming. Asked now, the screen says it is not there, and a suite
  // records a pass on a branch it never observed. This test passes, and that is
  // the finding: it would pass either way.
  await page.goto('/?show=yes');
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 0 });
});

test('a process can be waited to its end', async ({ page, events }) => {
  await page.goto('/?show=no');
  const ended = await events.finished('checkout', 'upsell-modal', 'deciding');
  expect(ended.phase).toBe('end');
  expect(events.pending.map((event) => event.location)).not.toContain('checkout');
});

test('the service behind the page announces too', async ({ page, events }) => {
  await page.goto('/?show=yes');
  const quoted = await events.happened('pricing', 'upsell', 'quoted');
  expect(quoted.realm).toBe('pricing');
  await events.finished('pricing', 'upsell', 'quoting');
});

test('an announcement already heard is asserted without waiting', async ({ page, events }) => {
  await page.goto('/?show=yes');
  await events.happened('checkout', 'upsell-modal', 'decided');
  expect(events.saw('checkout', 'upsell-modal', 'decided')).toBe(true);
  expect(events.saw('checkout', 'upsell-modal', 'dismissed')).toBe(false);
});

for (const index of [1, 2, 3, 4, 5, 6]) {
  test(`concurrent execution ${index} hears its own request and no other`, async ({
    page,
    events,
  }) => {
    await page.goto(index % 2 === 0 ? '/?show=yes' : '/?show=no');
    await events.happened('pricing', 'upsell', 'quoted');
    const quotes = events.seen.filter(
      (event) => event.realm === 'pricing' && event.action === 'quoted',
    );
    expect(quotes).toHaveLength(1);
  });
}
