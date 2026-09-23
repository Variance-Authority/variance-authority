// The claim under test is that one execution of one spec, driven through a
// browser into a service the driver cannot see inside, comes back as two
// different kinds of evidence under one id: an announcement the spec waits on,
// and a record of which regions of that service's source it entered — enough
// for the next run to skip the spec that never went there.
//
// Nothing in this case writes a report. The service is handed a `Cookie` header
// and nothing else; the only artifact is the coverage index the driver merges
// into at teardown, and it is written to a directory this file made.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { selectTestFiles } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Recorded names are relative to the checkout, and this case sits inside it.
const at = (path) => `${relative(dirname(dirname(root)), root)}/${path}`;
const cli = fileURLToPath(new URL('../../../node_modules/@playwright/test/cli.js', import.meta.url));

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
    '\ncases/journey-tracing-case: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

// A port per invocation, because two of these runs may be in flight at once.
let next = 4519;

function playwright(work) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'test', '--config=src/playwright.config.mjs'], {
      cwd: root,
      env: {
        ...process.env,
        VA_PORT: String((next += 1)),
        VA_RESULTS: join(work, 'playwright-results'),
        VA_COVERAGE: join(work, 'coverage.bin'),
        // The inventory the service's build writes and the driver reads back.
        // Keyed by repository, so pointing both at one directory is the whole of
        // what keeps this run out of a developer's own cache.
        XDG_CACHE_HOME: join(work, 'cache'),
      },
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
  const work = await mkdtemp(join(tmpdir(), 'variance-journey-'));
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

/** The line a branch returns on, read from the source rather than counted here. */
async function lineOf(text) {
  const source = await readFile(join(root, 'src/pricing.mjs'), 'utf8');
  const found = source.split('\n').findIndex((line) => line.includes(text));
  expect(found, `${text} is in src/pricing.mjs`).toBeGreaterThan(-1);
  return found + 1;
}

live('a journey that crosses into a service', () => {
  it('is announced and recorded under one id, and narrows the next run', async () => {
    await inFreshWork(async (work) => {
      const run = await playwright(work);
      expect(run, run.output).toMatchObject({ code: 0 });
      expect(run.output).toContain('2 passed');
      // The half that is easy to pass by accident: a run whose heads went
      // missing says so here and records every spec as incomplete.
      expect(run.output).not.toContain('variance-authority:');

      const coverage = join(work, 'coverage.bin');
      const euros = await lineOf("'1200 EUR'");
      const dollars = await lineOf("'1200 USD'");

      // Neither spec mentions the other's branch, and neither one ran a line of
      // this file: it executed in the service, and this is the driver reading
      // back what the service reported about it.
      expect(await selectTestFiles(coverage, diffAt(at('src/pricing.mjs'), euros))).toEqual([
        at('src/spec/euros.spec.mjs'),
      ]);
      expect(await selectTestFiles(coverage, diffAt(at('src/pricing.mjs'), dollars))).toEqual([
        at('src/spec/dollars.spec.mjs'),
      ]);
    });
  }, 120_000);
});
