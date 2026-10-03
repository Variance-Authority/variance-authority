import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, type Browser, type Locator, type TestInfo } from '@playwright/test';
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

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/playwright-test snapshot case: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

/** What one observation's snapshot names when `seeded` is said at `when`. */
async function namedWhenSaid(when: 'comparing' | 'reading the accessibility tree'): Promise<{
  readonly snapshot: readonly (readonly [string, string | boolean])[] | undefined;
  readonly row: readonly string[] | undefined;
}> {
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

    // The engine is asked where components are declared after the document is
    // captured, so a call there lands between the capture and the verdict, as a
    // case's concurrent code can.
    const declared: DeclarationReader = {
      read: async () => {
        if (when === 'comparing') variancePrecondition('seeded');
        return {};
      },
      stats: { asked: 0, located: 0 },
      close: async () => {},
    };
    // The same locator, saying `seeded` once the page agent has answered and
    // the accessibility tree is still being read.
    const real = page.locator('#receipt');
    let said = false;
    const locator = new Proxy(real, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if (property === 'ariaSnapshot' && when === 'reading the accessibility tree' && !said) {
          return async (...args: Parameters<Locator['ariaSnapshot']>) => {
            said = true;
            const [tree] = await Promise.all([target.ariaSnapshot(...args), Promise.resolve().then(() => variancePrecondition('seeded'))]);
            return tree;
          };
        }
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });

    const observed = await observeLocator(
      {
        page,
        run: { id: 'receipt', accepting: true },
        store: createDurableStore(resolve(root, 'baselines')),
        materialization: { kind: 'in-place', browser: { headless: true, launchArgs: [...CHROMIUM_RASTER_ARGS] } },
        declared,
        arranged: () => snapshotCaseOf(testInfo, recorder),
      },
      locator,
      { subjectId: 'receipt' },
    );
    const row = snapshotCaseOf(testInfo, recorder).preconditions?.map(({ name }) => name);
    await recorder.close();
    return { snapshot: observed.case?.preconditions?.map(({ name, value }) => [name, value] as const), row };
  } finally {
    await page.close();
    await rm(root, { recursive: true, force: true });
  }
}

chromium_('a snapshot taken inside a case', () => {
  it('names the preconditions said before its document was captured, not those said while it was compared', async () => {
    expect(await namedWhenSaid('comparing')).toEqual({
      snapshot: [['network', 'mocked']],
      // Said all the same: the case holds it for its row.
      row: ['network', 'seeded'],
    });
  }, 60_000);

  it('does not name a precondition said while the accessibility tree was still being read', async () => {
    expect(await namedWhenSaid('reading the accessibility tree')).toEqual({
      snapshot: [['network', 'mocked']],
      row: ['network', 'seeded'],
    });
  }, 60_000);
});
