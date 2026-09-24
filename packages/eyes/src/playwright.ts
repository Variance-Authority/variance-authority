import type {
  Fixtures,
  Locator,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs,
} from '@playwright/test';
import { relative, sep } from 'node:path';
import {
  createEyesLog,
  eyesTestAttention,
  type AttentionDraft,
  type EyesLog,
  type TargetSnapshot,
} from './access.js';
import { recordEyesTest } from './collect.js';
import { eyesStage } from './stage.js';
import { bundleEyesAgent } from './bundle.js';
import {
  EYES_AGENT,
  EYES_AGENT_VERSION,
  EYES_RECORD,
  type InstalledEyesAgent,
} from './page-agent.js';
import { instrumentPage } from './playwright-proxy.js';

export interface EyesFixtures {
  /**
   * Attention collected for this test. The page fixture writes it, and teardown
   * publishes it when `@variance-authority/eyes/reporter` is installed.
   */
  readonly eyes: EyesLog;
}

export interface EyesWorkerFixtures {
  readonly eyesBundle: string;
}

async function snapshotLocator(locator: Locator): Promise<readonly TargetSnapshot[]> {
  return locator.evaluateAll((nodes, expected) => {
    const page = globalThis as typeof globalThis & {
      [key: string]: InstalledEyesAgent | undefined;
    };
    const agent = page[expected.name];
    if (agent === undefined || agent.version !== expected.version) {
      throw new Error(`eyes page agent ${expected.version} is not installed`);
    }
    return nodes.map((node) => agent.snapshot(node));
  }, { name: EYES_AGENT, version: EYES_AGENT_VERSION });
}

/**
 * Unbound fixture parts for the extension module a Playwright suite already owns.
 *
 * The fixture overrides `page` with an API-compatible proxy; it exports neither
 * `test` nor `expect`. Playwright assertions reach the proxy through Locator's
 * own consumption path, so the suite keeps its matcher surface too.
 */
export const eyesFixtures: Fixtures<
  EyesFixtures,
  EyesWorkerFixtures,
  PlaywrightTestArgs,
  PlaywrightWorkerArgs
> = {
  eyesBundle: [
    // Playwright parses this parameter to discover dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(await bundleEyesAgent());
    },
    { scope: 'worker' },
  ],

  // Closed at teardown, after `page` — which depends on it and is therefore torn
  // down first — so every entry the page reported is in before the journal is.
  // Published only when a run named a stage: without the reporter there is no
  // process to fold into, and the journal stays the test's own to drain.
  // eslint-disable-next-line no-empty-pattern
  eyes: async ({}, use, testInfo) => {
    const log = createEyesLog();
    await use(log);
    const stage = eyesStage();
    if (stage === undefined) return;
    await recordEyesTest(
      stage.directory,
      eyesTestAttention(
        {
          id: testInfo.testId,
          attempt: testInfo.retry,
          title: testInfo.title,
          file: relative(stage.root, testInfo.file).split(sep).join('/'),
        },
        log.drain(),
      ),
    );
  },

  page: async ({ page, eyes, eyesBundle }, use) => {
    await page.exposeFunction(EYES_RECORD, (attention: AttentionDraft) => {
      eyes.record(attention);
    });
    await page.addInitScript({ content: eyesBundle });

    // `addInitScript` owns future navigations. The initial about:blank document
    // already exists when fixtures run, and `setContent` does not trigger it.
    const installCurrentDocument = async (force = false): Promise<void> => {
      await page.evaluate(eyesBundle);
      if (force) {
        await page.evaluate((agentName) => {
          const page = globalThis as typeof globalThis & {
            [key: string]: InstalledEyesAgent | undefined;
          };
          page[agentName]?.installDocument(true);
        }, EYES_AGENT);
      }
    };
    await installCurrentDocument();

    await use(instrumentPage(page, eyes, snapshotLocator, () => installCurrentDocument(true)));
  },
};

export { bundleEyesAgent, EYES_AGENT, EYES_AGENT_VERSION, EYES_RECORD };
