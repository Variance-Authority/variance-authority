/**
 * What the persistent harness is worth, in wall-clock seconds.
 *
 * The economic argument of this project is that a semantic capture costs less
 * than a screenshot. A harness that launches a browser per subject spends that
 * saving before it collects anything, so "persistent" is not a tidiness
 * preference — it is the claim. This measures it.
 *
 * Two arms over the same corpus, in the same process, back to back:
 *
 *   cold  — new browser, new page, new navigation, new bundle injection, per subject
 *   warm  — one browser, one page, one navigation, one injection, N `page.evaluate`s
 *
 * Both arms call the same `capture` (`captureOnce` wraps `createHarness`), so the
 * difference is process and navigation cost and nothing else. A benchmark whose
 * slow arm is a bespoke script measures the script.
 *
 * Run:  yarn workspace @variance-authority/example-kitchen-sink bench
 */
import { createHarness, captureOnce } from '@variance-authority/playwright';
import { CORPUS } from '../dist/corpus.js';
import { buildAgentBundle, HARNESS_PAGE_URL } from './agent-bundle.mjs';

const VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' };

/**
 * Every distinct `(subject, variant)` render the corpus needs, deduplicated.
 *
 * Deduplicated because a real run captures each render once and diffs pairs; a
 * benchmark that re-rendered `base` forty times would flatter the warm arm with
 * work no honest caller performs.
 */
function workload() {
  const seen = new Set();
  const pairs = [];
  for (const c of CORPUS) {
    for (const variant of [c.baseVariant, c.perturbedVariant]) {
      const key = `${c.subject}/${variant}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([c.subject, variant]);
    }
  }
  return pairs;
}

async function cold(options, pairs) {
  const started = performance.now();
  for (const [subject, variant] of pairs) await captureOnce(options, subject, variant);
  return performance.now() - started;
}

async function warm(options, pairs) {
  const started = performance.now();
  const harness = await createHarness(options);
  try {
    for (const [subject, variant] of pairs) await harness.capture(subject, variant);
  } finally {
    await harness.close();
  }
  return performance.now() - started;
}

const pairs = workload();

// Built once and handed to both arms. A real caller builds the bundle as part of
// its build, not per capture, so charging it to either arm would measure esbuild.
const options = {
  url: HARNESS_PAGE_URL,
  bundle: await buildAgentBundle(),
  viewport: VIEWPORT,
  fonts: ['Inter/400/normal/corpus'],
};

// One capture before the clock starts. The first browser launch pays for OS page
// cache and Playwright's own driver startup, and charging that to whichever arm
// ran first would be a measurement of the running order.
await captureOnce(options, pairs[0][0], pairs[0][1]);

const warmMs = await warm(options, pairs);
const coldMs = await cold(options, pairs);

const ms = (value) => `${value.toFixed(0)} ms`;
const per = (value) => `${(value / pairs.length).toFixed(1)} ms/capture`;

console.log(
  [
    '',
    'PERSISTENT HARNESS — cost of a capture',
    `  captures:      ${pairs.length} distinct (subject, variant) renders`,
    `  cold           ${ms(coldMs).padStart(9)}   ${per(coldMs)}   (browser + page + navigate + inject, per subject)`,
    `  warm           ${ms(warmMs).padStart(9)}   ${per(warmMs)}   (one browser, one page, no reload)`,
    `  ratio          ${(coldMs / warmMs).toFixed(1)}x`,
    '',
    '  reproduce: yarn build && yarn workspace @variance-authority/example-kitchen-sink bench',
    '',
  ].join('\n'),
);
