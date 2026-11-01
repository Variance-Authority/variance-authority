// What a story switch costs on one page under the isolator, against the same
// page without the reset and against a fresh page per story.
//
//   yarn workspace @variance-authority/case-storybook build-storybook:isolated
//   yarn workspace @variance-authority/case-storybook bench:switch [stories] [runs]
//
// Shows the two isolated `Isolated/Tally` stories in turn, `stories` times (40
// by default), once on one page whose first project loader starts a new
// isolator session per story, and once with a new page per story. Each of those
// stories is checked to read the count it would read on a page of its own, so
// the one page is only faster if it is also right. The two `sharedModules`
// stories, shown the same way on one page, skip the reset: the gap between them
// and the isolated stories is what the isolator costs per switch. Reports the median of `runs` (5 by
// default) per story; a time is one machine's.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { collectStories } from '@variance-authority/storybook';

const ROOT = fileURLToPath(new URL('../storybook-isolated', import.meta.url));
const STORIES = Number(process.argv[2] ?? 40);
const RUNS = Number(process.argv[3] ?? 5);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };

if (!existsSync(join(ROOT, 'index.json'))) throw new Error('No isolated build: yarn workspace @variance-authority/case-storybook build-storybook:isolated');

const server = createServer((request, response) => {
  const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
  const resolved = join(ROOT, normalize(path === '/' ? '/index.html' : path));
  if (!resolved.startsWith(ROOT) || !existsSync(resolved)) return response.writeHead(404).end();
  response.writeHead(200, { 'content-type': TYPES[extname(resolved)] ?? 'application/octet-stream' }).end(readFileSync(resolved));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const alternate = (first, second) => Array.from({ length: STORIES }, (_, index) => (index % 2 === 0 ? first : second));
const ids = alternate('isolated-tally--first', 'isolated-tally--second');
const shared = alternate('isolated-tally--shared-first', 'isolated-tally--shared-second');
const browser = await chromium.launch({ headless: true });

async function show(page, stories) {
  const shown = [];
  await collectStories(page, stories, {
    baseUrl,
    observe: async () => shown.push(await page.locator('#storybook-root output').textContent()),
  });
  return shown;
}

/** Shows `stories` on one new page. */
async function onePage(stories) {
  const page = await browser.newPage();
  try {
    return await show(page, stories);
  } finally {
    await page.close();
  }
}

// Each way says whether its stories must each read their own count.
const ways = {
  'one page, no reset': { checked: false, run: () => onePage(shared) },
  'one page': { checked: true, run: () => onePage(ids) },
  'a page per story': {
    checked: true,
    run: async () => {
    const shown = [];
    for (const id of ids) {
      const page = await browser.newPage();
      try {
        shown.push(...(await show(page, [id])));
      } finally {
        await page.close();
      }
    }
    return shown;
  } },
};

try {
  for (const [way, { checked, run }] of Object.entries(ways)) {
    const times = [];
    for (let round = 0; round < RUNS; round += 1) {
      const started = performance.now();
      const shown = await run();
      times.push((performance.now() - started) / STORIES);
      if (checked && shown.some((value) => value !== '1')) throw new Error(`${way}: a story read another's count: ${shown.join(' ')}`);
    }
    times.sort((a, b) => a - b);
    console.log(`${way}: ${times[Math.floor(RUNS / 2)].toFixed(1)} ms per story (${times[0].toFixed(1)}–${times.at(-1).toFixed(1)}), ${STORIES} stories × ${RUNS}`);
  }
} finally {
  await browser.close();
  server.close();
}
