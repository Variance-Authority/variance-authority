import { test as base } from '@playwright/test';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';

const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

test.describe('Greeting', () => {
  test('says hello', async ({ page, variance }) => {
    // Navigated rather than set, so the page runs the fixture's init script.
    await page.route('http://greeting.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Hello</h1>' }));
    await page.goto('http://greeting.test/');
    await variance(page.locator('h1'));
  });
});
