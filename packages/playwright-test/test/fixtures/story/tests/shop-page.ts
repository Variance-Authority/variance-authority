import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base } from '@playwright/test';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';
import { executionCollectorSource, testSelectionProbes } from '@variance-authority/sense/journal';

export const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

// The page an instrumented build serves: the collector the build hoists, then
// `src/shop.js` as the build's probes leave it.
const file = fileURLToPath(new URL('../src/shop.js', import.meta.url));
const probed = testSelectionProbes({ root: fileURLToPath(new URL('../../../../../..', import.meta.url)) })
  .transform.handler(readFileSync(file, 'utf8'), file)!
  .code.replace(/\n;import "[^"]+";$/, '');
export const PAGE = `<script>${executionCollectorSource()}</script>
<script>${probed}</script>
<button id="choose" onclick="shop.choose('tea')">Choose</button>
<button id="pay" onclick="shop.pay(20)">Pay</button>`;
