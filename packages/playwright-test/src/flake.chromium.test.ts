import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium } from '@playwright/test';
import { compareOutcomes } from '@variance-authority/sense/story';
import { afterAll, describe, expect, it } from 'vitest';
// The record's sections are read by sense's own readers, which it publishes
// only through the checkout's records, so this reads them the way they do.
import { caseSectionsOf } from '../../sense/src/test-selection/case-record.js';
import { readingsOf } from '../../sense/src/test-selection/case-readings.js';

// Real Playwright runs over a spec that throws when it clicks before the page
// wires its button, and one whose only difference between runs is a timer.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const fixture = resolve(here, '../test/fixtures/flake');
const spec = 'packages/playwright-test/test/fixtures/flake/tests/page.spec.ts';
const directories: string[] = [];

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/playwright-test flake: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.runIf(BROWSER_AVAILABLE)('a Playwright case that fails on some runs', () => {
  it('names what moved with the outcome, and nothing where only a timer moved', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-playwright-flake-'));
    directories.push(directory);
    const coverageFile = resolve(directory, 'coverage.bin');
    const record = (env: Readonly<Record<string, string>>) => promisify(execFile)(
      process.execPath,
      [resolve(repository, 'node_modules/@playwright/test/cli.js'), 'test', '--config', resolve(fixture, 'playwright.config.mjs')],
      { cwd: fixture, env: { ...process.env, ...env, VARIANCE_AUTHORITY_COVERAGE: coverageFile, VARIANCE_AUTHORITY_CACHE: resolve(directory, 'cache') } },
    ).then(() => 'passed', () => 'threw');
    const lines = (await readFile(resolve(fixture, 'tests/page.spec.ts'), 'utf8')).split('\n');
    const line = (statement: string) => lines.findIndex((text) => text.endsWith(`// ${statement}`)) + 1;

    // Each run, `clicks` and `ticks` pass or throw together, and the timer lands early on half of each.
    expect(await record({ TICK_EARLY: '1' })).toBe('passed');
    expect(await record({ CLICK_FIRST: '1', THROW: '1' })).toBe('threw');
    expect(await record({})).toBe('passed');
    expect(await record({ CLICK_FIRST: '1', THROW: '1', TICK_EARLY: '1' })).toBe('threw');

    const { index, readings } = caseSectionsOf(await readFile(coverageFile));
    const compared = (name: string) => compareOutcomes({ file: spec, name, readings: readingsOf(readings, index, `${spec} > ${name}`)! });

    const clicks = compared('clicks')!;
    expect(clicks).toMatchObject({ passed: 2, threw: 2, single: false });
    expect(clicks.onlyPassed.map(({ name }) => name)).toEqual(['handle']);
    expect(clicks.moved.map(({ region, passed, threw }) => [region.name, passed, threw])).toEqual([['wire', { line: line('waits') }, { line: line('checks') }]]);

    const ticks = compared('ticks')!;
    expect(ticks).toMatchObject({ passed: 2, threw: 2, onlyPassed: [], onlyThrew: [], moved: [], unsteady: 1 });
  }, 240_000);
});
