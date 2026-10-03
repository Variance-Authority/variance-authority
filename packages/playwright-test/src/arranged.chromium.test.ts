import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, type Browser, type TestInfo } from '@playwright/test';
import type { DeclarationReader } from '@variance-authority/playwright';
import type { PreconditionStanding } from '@variance-authority/sense/journal';
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { createDurableStore } from '@variance-authority/store/durable';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { snapshotCaseOf } from './arranged.js';
import { bundlePageAgent } from './bundle.js';
import { createExecutionRecorder } from './execution.js';
import { observeLocator } from './fixture.js';
import { CHROMIUM_RASTER_ARGS } from './index.js';
import { caseKey } from './test-coordinate.js';

/**
 * The case a snapshot names is the one its document was captured in.
 *
 * An observation goes on working after the capture: it asks the engine where
 * components are declared, renders, compares and writes evidence, all of it
 * awaited while the case's own code may still be running. A precondition said
 * in that window is not one the captured document was taken under.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

let browser: Browser | undefined;

beforeAll(async () => {
  if (BROWSER_AVAILABLE) browser = await chromium.launch({ headless: true, args: [...CHROMIUM_RASTER_ARGS] });
});

afterAll(async () => {
  await browser?.close();
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

chromium_('a snapshot taken inside a case', () => {
  it('names the preconditions said before its document was captured, not those said while it was compared', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-playwright-captured-'));
    const page = await browser!.newPage({ viewport: { width: 400, height: 300 } });
    try {
      const owner = 'tests/checkout.spec.ts';
      const testInfo = {
        project: { name: 'chromium' },
        file: resolve(root, owner),
        titlePath: ['chromium', owner, 'mocked', 'pays'],
        testId: 'one',
      } as unknown as TestInfo;
      const standing: PreconditionStanding = { at: 'case', key: caseKey(owner, 'one') };
      const recorder = createExecutionRecorder({ root, coverageFile: resolve(root, 'coverage.bin') }, undefined, () => standing);

      await page.setContent('<p id="receipt">Paid</p>');
      await page.evaluate(await bundlePageAgent());

      variancePrecondition('network', 'mocked');
      // The engine is asked where components are declared only after the
      // document is captured, so this call lands between the capture and the
      // verdict, as a case's concurrent code can.
      const declared: DeclarationReader = {
        read: async () => {
          variancePrecondition('seeded');
          return {};
        },
        stats: { asked: 0, located: 0 },
        close: async () => {},
      };

      const observed = await observeLocator(
        {
          page,
          run: { id: 'receipt', accepting: true },
          store: createDurableStore(resolve(root, 'baselines')),
          materialization: { kind: 'in-place', browser: { headless: true, launchArgs: [...CHROMIUM_RASTER_ARGS] } },
          declared,
          arranged: () => snapshotCaseOf(testInfo, recorder),
        },
        page.locator('#receipt'),
        { subjectId: 'receipt' },
      );

      expect(observed.case?.preconditions?.map(({ name, value }) => [name, value])).toEqual([['network', 'mocked']]);
      // Said all the same: the case holds it for its row.
      expect(snapshotCaseOf(testInfo, recorder).preconditions?.map(({ name }) => name)).toEqual(['network', 'seeded']);
      await recorder.close();
    } finally {
      await page.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
