// The claim under test is that an ordinary Playwright spec over a probed
// Storybook build is recorded by the page it opened itself — whether it names
// anything from this project or not, through Storybook's manager or straight to
// a story, in one tab or two, and past its own `afterEach` — and that a spec
// which replaced a document it ran in is never believed whole.
//
// Storybook is built here, by its own CLI, into a directory this file made:
// the probes write their records while it builds, and the run reads them back.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { narrowByExecution, readTestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Recorded names are relative to the checkout, and this case sits inside it.
const at = (path) => `${relative(dirname(dirname(root)), root)}/${path}`;
const modules = fileURLToPath(new URL('../../../node_modules/', import.meta.url));

const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const live = BROWSER_AVAILABLE ? describe : describe.skip;

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\ncases/playwright-storybook-case: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

// A port per invocation, because two of these runs may be in flight at once.
let next = 4619;

function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, output }));
  });
}

async function inFreshWork(body) {
  const work = await mkdtemp(join(tmpdir(), 'variance-storybook-'));
  try {
    return await body(work);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** One line of one file changed, in the only part of a diff the selector reads. */
function diffAt(file, line) {
  return `--- a/${file}\n+++ b/${file}\n@@ -${line},1 +${line},1 @@\n`;
}

/** The first line holding `text`, read from the source rather than counted here. */
async function lineOf(text) {
  const source = await readFile(join(root, 'src/price.js'), 'utf8');
  const found = source.split('\n').findIndex((line) => line.includes(text));
  expect(found, `${text} is in src/price.js`).toBeGreaterThan(-1);
  return found + 1;
}

const sorted = (paths) => [...paths].sort();
const specs = (...names) => sorted(names.map((name) => at(`src/spec/${name}.spec.mjs`)));

live('a Playwright suite over a Storybook it opens itself', () => {
  it('records every spec by the documents it held, and never a replaced one as whole', async () => {
    await inFreshWork(async (work) => {
      // The records the probes write while Storybook builds, and the ones the
      // run reads back, are keyed by repository under the user cache, so one
      // `XDG_CACHE_HOME` for both is the whole of what keeps this run out of a
      // developer's own.
      const cache = { XDG_CACHE_HOME: join(work, 'cache') };
      const built = await run(
        [join(modules, 'storybook/bin/index.cjs'), 'build', '-o', join(work, 'static'), '--quiet'],
        cache,
      );
      expect(built, built.output).toMatchObject({ code: 0 });

      const coverage = join(work, 'coverage.bin');
      const driven = await run(
        [join(modules, '@playwright/test/cli.js'), 'test', '--config=src/playwright.config.mjs'],
        {
          ...cache,
          VA_PORT: String((next += 1)),
          VA_STATIC: join(work, 'static'),
          VA_RESULTS: join(work, 'playwright-results'),
          VA_COVERAGE: coverage,
        },
      );
      expect(driven, driven.output).toMatchObject({ code: 0 });
      expect(driven.output).toContain('7 passed');
      // A page with no collector, a worker without the reporter, a record the
      // fold refused: each of them says so here, and none of them may.
      expect(driven.output).not.toContain('variance-authority:');

      // Every spec, including the five that destructure nothing but `page`. The
      // two that replaced their document are recorded — what the last document
      // entered is still evidence of what the spec needs — and are not whole.
      const { tests } = await readTestCoverage(coverage);
      expect(sorted(tests.filter((test) => !test.complete).map((test) => test.file))).toEqual(
        specs('navigate', 'reload'),
      );
      expect(sorted(tests.map((test) => test.file))).toEqual(
        specs('after-each', 'manager', 'navigate', 'plain', 'popup', 'reload', 'variance'),
      );

      const ask = async (line) => narrowByExecution(coverage, diffAt(at('src/price.js'), line));

      // The branch every premium price takes. `popup` reached it only in the
      // tab it opened itself.
      const doubled = await ask(await lineOf('return amount * 2'));
      expect(sorted(doubled.entered)).toEqual(specs('plain', 'popup', 'reload', 'variance'));
      expect(sorted(doubled.whole)).toEqual(
        specs('after-each', 'manager', 'plain', 'popup', 'variance'),
      );

      // The discount is taken after a click: through the manager's preview
      // iframe, after a navigation, and inside an `afterEach`.
      const discounted = await ask(await lineOf('return amount - 10'));
      expect(sorted(discounted.entered)).toEqual(specs('after-each', 'manager', 'navigate'));

      // A plain price. `navigate` rendered one too, in the document its second
      // `goto` replaced, and that crossing went with the document. It is not
      // selected here — and it is not whole either, so a selection that
      // excludes on this answer runs it anyway.
      const plain = await ask(await lineOf('return amount;'));
      expect(plain.entered).toEqual(specs('popup'));
      expect(plain.whole).not.toContain(at('src/spec/navigate.spec.mjs'));
    });
  }, 180_000);
});
