// The claim under test is that a Playwright suite's own recording run, with
// Eyes on, is enough to hold each test against what it says: the steps and
// assertions it made, what it ran, what it adds to the suite, and the branches
// it passed by. Nothing runs at question time.
//
// The suite runs in a checkout of its own, as a project that installed
// variance runs it: the record is kept for that checkout, where `variance ask`
// asked from it finds it.

import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, symlinkSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { unbuilt } from '../../unbuilt.mjs';

const CASE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(CASE, '../..');
const PLAYWRIGHT = join(ROOT, 'node_modules/@playwright/test/cli.js');
const CLI = join(ROOT, 'packages/cli/dist/bin.js');
const SPEC = 'src/spec/signup.spec.mjs';

const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const READY = BROWSER_AVAILABLE && existsSync(CLI);
const live = READY ? describe : describe.skip;

if (!READY) {
  unbuilt(
    '\ncases/test-claims-case: skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (existsSync(CLI) ? '' : '\n  the CLI is not built — yarn build') +
      '\n',
  );
}

/** A checkout holding the suite, with this repository's installed packages; the cache beside it keeps the run out of a developer's own. */
async function project() {
  const work = await mkdtemp(join(tmpdir(), 'variance-test-claims-'));
  const checkout = join(work, 'project');
  cpSync(join(CASE, 'src'), join(checkout, 'src'), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(checkout, 'node_modules'), 'dir');
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: checkout, stdio: 'pipe' });
  const env = { ...process.env, VARIANCE_AUTHORITY_CACHE: join(work, 'cache'), VA_RESULTS: join(work, 'results') };
  // A child run is a fixture: its reporter does not write the outer job's summary.
  delete env.GITHUB_ACTIONS;
  return { work, checkout, env };
}

function run(command, args, { checkout, env }) {
  return new Promise((settle, reject) => {
    const child = spawn(process.execPath, [command, ...args], { cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk.toString()));
    child.stderr.on('data', (chunk) => (err += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => settle({ code, out, err }));
  });
}

live('a Playwright suite recorded with Eyes', () => {
  it('says what each test claims, runs, adds and passes by', async () => {
    const at = await project();
    try {
      const recorded = await run(PLAYWRIGHT, ['test', '--config=src/playwright.config.mjs'], at);
      expect(recorded.code, recorded.out + recorded.err).toBe(0);
      expect(recorded.out).toContain('8 passed');

      const ask = async (name) => {
        const answered = await run(CLI, ['ask', 'test-claims', '--file', SPEC, '--name', name], at);
        expect([answered.code, answered.err]).toEqual([0, '']);
        return answered.out.split('\n');
      };

      // Its name says it retries; what it did is what the plain submit does,
      // and the retry is a branch no test takes.
      const retries = await ask('retries a failed post');
      expect(retries.slice(0, 10)).toEqual([
        `${SPEC}  signup > retries a failed post`,
        '',
        'Claims:',
        '  its name: signup > retries a failed post',
        '  its steps and assertions:',
        '    action fill on locator("#name")',
        '    action fill on locator("#email")',
        '    action fill on locator("#surname")',
        '    action click on getByRole("button", {"name":"Sign up"})',
        '    assertion to.have.text on getByRole("status")',
      ]);
      expect(retries).toContain('  executes exactly what 1 other test executes:');
      expect(retries).toContain(`    ${SPEC}  signup > submits the form`);
      expect(retries).toContain('  src/app/http.js:18  branch in post  no test takes it');

      // An assertion against something keeps its `.not`, and the one branch
      // this test enters alone is the one its name is about.
      const missing = await ask('missing name');
      expect(missing).toContain('    assertion not.to.be.empty on locator("#name-hint")');
      expect(missing).toContain('  only this test enters:');
      expect(missing).toContain('    src/app/validate.js:3  branch in validate');
    } finally {
      await rm(at.work, { recursive: true, force: true });
    }
  });
});
