import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { checked, varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';
import { moduleId } from '@variance-authority/sense/journal';

const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

// The page enters a region of `src/create-event.ts` for each thing it does, the
// way an instrumented build's collector would: `submit` when the form is sent,
// `list` when the events are shown.
const MODULE = moduleId(
  'packages/playwright-test/test/fixtures/create-event/src/create-event.ts',
  readFileSync(new URL('../src/create-event.ts', import.meta.url), 'utf8'),
);
const collector = `<script>
const entered = new Set([0]);
globalThis.__variance_authority_execution__ = {
  drain: () => {
    const hits = [...entered];
    entered.clear();
    return { instrumentation: 'sense:instrument/presence-v6', modules: [{ id: '${MODULE}', hits, shared: [] }] };
  },
};
</script>`;

// The form sends what it holds, except under `DROP_TITLE`, where it sends
// nothing and still reaches `saved`: the branch the check is there for.
const form = `${collector}<script>
addEventListener('DOMContentLoaded', () => {
  document.getElementById('form').onsubmit = (event) => {
    event.preventDefault();
    entered.add(1);
    const title = document.getElementById('title').value;
    globalThis.sent = ${process.env['DROP_TITLE'] === '1' ? '{}' : '{ title }'};
    document.getElementById('phase').textContent = 'saved';
  };
});
</script>
<form id="form"><input id="title"><button>Create</button></form><p id="phase"></p>`;

test.describe('create-event', () => {
  test('submits the form', async ({ page }) => { // bypassing case
    await page.setContent(form);
    await page.fill('#title', 'Launch');
    await page.click('button');
    await expect(page.locator('#phase')).toHaveText('saved');
    const sent = await page.evaluate(() => (globalThis as { sent?: { title?: string } }).sent);
    if (process.env['STALL'] === '1') {
      // Ctrl+C at the runner while this case is still running, before its check.
      process.kill(process.ppid, 'SIGINT');
      await page.waitForTimeout(60_000);
    }
    // The check runs only when a title was sent, so a form that drops it passes unchecked.
    if (sent?.title !== undefined) {
      checked('create-event/submitted-title', () => expect(sent.title).toBe('Launch')); // bypassed check
    }
  });

  test('lists events', async ({ page }) => {
    await page.setContent(`${collector}<script>entered.add(2)</script><ul><li>Launch</li></ul>`);
    await expect(page.locator('li')).toHaveText('Launch');
  });
});

test.describe('retries', () => {
  test.describe.configure({ retries: 1 });

  // The first attempt enters its check and fails; the retry passes without it.
  test('passes the retry without its check', () => { // retried case
    if (test.info().retry === 0) {
      checked('create-event/retried-title', () => expect('').toBe('Launch')); // retried check
    }
  });
});
