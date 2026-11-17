import { test as base } from '@playwright/test';
import { varianceFixtures } from '@variance-authority/playwright-test';
import { App } from './broker/broker.js';
import { watch } from './broker/settle.js';

export const test = base.extend(varianceFixtures).extend<{ app: App }>({
  app: async ({ page, events }, use, testInfo) => {
    watch(page);
    const app = new App(page, { events });
    await use(app);
    // The walk, as declared edges, beside the test's own output.
    await testInfo.attach('journal', { body: JSON.stringify(app.journal, null, 2), contentType: 'application/json' });
  },
});
export { expect } from '@playwright/test';
