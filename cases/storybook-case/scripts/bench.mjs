// What a Storybook run spends on browsers and the wire, at 1 and 4 workers.
//
//   yarn workspace @variance-authority/case-storybook build-storybook
//   yarn workspace @variance-authority/case-storybook bench [runs]
//
// Opens a run the way `variance run` does — the collector's own world, a world
// per further worker, then the renderer — reads every story of the build
// round-robin across them, and counts what the browser did: `chromium.launch`
// calls, `load` events on preview pages, and Resource Timing entries that
// crossed the wire (`transferSize > 0`). The counts are exact on any machine.
// Opening the run is timed too, and reported as the median of `runs` (3 by
// default), with the slowest and fastest beside it; a time is one machine's.
//
// It reads the packages as built, so build after every pull, and on another
// checkout to compare against it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import { storybookCollector } from '@variance-authority/storybook-collector';

const INDEX = fileURLToPath(new URL('../storybook-static/index.json', import.meta.url));
const RUNS = Number(process.argv[2] ?? 3);
const LANES = [1, 4];

const ids = Object.values(JSON.parse(readFileSync(INDEX, 'utf8')).entries)
  .filter((entry) => entry.type === 'story')
  .map((entry) => entry.id);

const CONFIG = {
  viewport: { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' },
  subjects: { index: INDEX },
};

let launched = [];
let loads = new Map();
const launch = chromium.launch.bind(chromium);
chromium.launch = async (options) => {
  const browser = await launch(options);
  launched.push(browser);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (contextOptions) => {
    const context = await newContext(contextOptions);
    context.on('page', (page) => {
      loads.set(page, 0);
      page.on('load', () => loads.set(page, loads.get(page) + 1));
    });
    return context;
  };
  return browser;
};

async function once(lanes) {
  launched = [];
  loads = new Map();
  const started = performance.now();
  const collector = await storybookCollector({})({ config: CONFIG });
  const workers = [];
  for (let lane = 1; lane < lanes; lane += 1) workers.push(await collector.openWorker());
  const renderer = await createPlaywrightRenderer({});
  const openMs = performance.now() - started;

  const all = [collector, ...workers];
  let ok = 0;
  await Promise.all(
    all.map(async (world, index) => {
      for (let i = index; i < ids.length; i += all.length) {
        const reading = await world.collect({ subject: { id: `story:${ids[i]}`, kind: 'story' } });
        if (reading.ok) ok += 1;
      }
    }),
  );

  let fetches = 0;
  let bytes = 0;
  for (const browser of launched) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (!page.url().includes('/iframe.html')) continue;
        const crossed = await page.evaluate(() =>
          [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')]
            .filter((entry) => entry.transferSize > 0)
            .map((entry) => entry.transferSize),
        );
        fetches += crossed.length;
        bytes += crossed.reduce((sum, size) => sum + size, 0);
      }
    }
  }
  const boots = [...loads].filter(([page]) => page.url().includes('/iframe.html'));
  const result = {
    launches: launched.length,
    boots: boots.reduce((sum, [, count]) => sum + count, 0),
    fetches,
    bytes,
    ok,
    openMs,
  };

  for (const worker of workers) await worker.close();
  await collector.close();
  await renderer.close();
  return result;
}

console.log(`${ids.length} stories, ${RUNS} runs per row`);
console.log('workers  launches  boots  fetches  MB     read  open ms (median, min-max)');
for (const lanes of LANES) {
  const runs = [];
  for (let run = 0; run < RUNS; run += 1) runs.push(await once(lanes));
  const [first] = runs;
  const open = runs.map((run) => run.openMs).sort((a, b) => a - b);
  console.log(
    [
      String(lanes).padEnd(8),
      String(first.launches).padEnd(9),
      String(first.boots).padEnd(6),
      String(first.fetches).padEnd(8),
      (first.bytes / 1024 / 1024).toFixed(1).padEnd(6),
      `${first.ok}/${ids.length}`.padEnd(5),
      `${Math.round(open[Math.floor(open.length / 2)])} (${Math.round(open[0])}-${Math.round(open.at(-1))})`,
    ].join(' '),
  );
}
