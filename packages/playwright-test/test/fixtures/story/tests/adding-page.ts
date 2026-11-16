import { PAGE, test } from './shop-page.js';

export const CHANGING = `${PAGE}
<button id="add" onclick="document.body.append(Object.assign(document.createElement('p'), { id: 'added', textContent: 'Added' }))">Add</button>`;

/** A cleanup declared here rather than in the spec that uses it, as a shared helper's is. */
export function addsAfterEach(): void {
  test.afterEach(async ({ page }) => {
    await page.click('#add');
  });
}
