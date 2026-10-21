import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain script, run by the workflow and by hand; no types to import.
import { lockstep, publishable, waiting } from './released.mjs';

/**
 * A release is checked against the registry, and stays checked.
 *
 * Two releases in one day reported success while doing part of the job — 0.5.6
 * reached five of thirty-eight names, 0.5.8 reached all of them and tagged
 * none — and neither was visible in an exit code. `tools/released.mjs` is what
 * asks the registry and the remote instead, and it is only worth anything if
 * the release workflow actually calls it, so that is asserted here rather than
 * left to a reviewer noticing its absence.
 *
 * Nothing here reaches the network. What the registry says is the release's
 * business; what this file guards is that somebody asks.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

/** One job of `release.yml`, from its key to the next job's. */
function job(name: string): string {
  const from = WORKFLOW.indexOf(`\n  ${name}:\n`);
  expect(from, `no job \`${name}\``).toBeGreaterThan(-1);
  const rest = WORKFLOW.slice(from + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

interface Entry {
  readonly name: string;
  readonly version: string;
}

describe('what a release publishes', () => {
  const packages = publishable() as readonly Entry[];

  // The platform packages live under `packages/sense/npm/` rather than
  // beside their siblings, and a check that walked only `packages/*` would have
  // called the split 0.5.6 complete — `sense-darwin-arm64` was one of the five
  // that published and the other two were not.
  it.each([
    '@variance-authority/sense-darwin-arm64',
    '@variance-authority/sense-linux-arm64-gnu',
    '@variance-authority/sense-linux-x64-gnu',
    '@variance-authority/sense-win32-x64-msvc',
  ])('includes %s', (name) => {
    expect(packages.map((entry) => entry.name)).toContain(name);
  });

  it('is every package that is not private', () => {
    expect(packages.length).toBeGreaterThan(30);
    expect(packages.every((entry) => entry.name.startsWith('@variance-authority/'))).toBe(true);
  });

  it('is one version, which is what `fixed` promises', () => {
    expect(lockstep(packages)).toMatch(/^\d+\.\d+\.\d+/);
  });

  // A changeset that names no package releases nothing, so `changeset version`
  // has nothing to raise for it. Counting it would hold the button for a
  // version pull request with no version in it.
  it('waits for a changeset that names a package, and not for an empty one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'changesets-'));
    const dir = join(root, '.changeset');
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, 'README.md'), '# Changesets\n');
      writeFileSync(join(dir, 'config.json'), '{}\n');
      writeFileSync(join(dir, 'all-pugs-flow.md'), '---\n---\n\n');
      expect(await waiting(root)).toEqual([]);
      writeFileSync(join(dir, 'tired-apples-obey.md'), "---\n'@variance-authority/core': patch\n---\n\nA fix.\n");
      expect(await waiting(root)).toEqual(['tired-apples-obey.md']);
      // What changesets cannot read holds the release, as it would hold `version`.
      writeFileSync(join(dir, 'some-kiwis-drum.md'), 'Notes\n---\nmore\n---\n');
      await expect(waiting(root)).rejects.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a version the packages disagree on', () => {
    expect(() =>
      lockstep([
        { name: '@variance-authority/core', version: '0.5.8' },
        { name: '@variance-authority/report', version: '0.5.7' },
      ]),
    ).toThrow(/not at one version/);
  });
});

describe('the release workflow', () => {
  it('will not publish packages that disagree on a version', () => {
    expect(WORKFLOW).toContain('tools/released.mjs --lockstep');
  });

  // The retry is the repair: `changeset publish` skips versions the registry
  // already has, so the command that truncated a release is the command that
  // finishes it. Without a second attempt this check turns a partial release
  // into a red job somebody has to fix by hand, which is better than green and
  // worse than done.
  it('asks the registry what published, and finishes what did not', () => {
    const publish = WORKFLOW.slice(WORKFLOW.indexOf('yarn release:publish'));
    expect(publish).toContain('tools/released.mjs --registry');
    expect(publish.match(/yarn release:publish/g)?.length).toBe(2);
  });

  // `check` ran every file on this commit when it reached `main`, so a press
  // asks it rather than running the suite again in one worker: ten minutes
  // that could only agree with it, spent before the first name reached npm.
  // Nothing publishes without that answer, and nothing waits for it to start
  // compiling either.
  it("publishes a commit main's CI passed, and does not run the suite itself", () => {
    const green = job('green');
    expect(green).toMatch(/gh run list [^\n]*--workflow check\.yml[^\n]*--event push/);
    expect(green).toMatch(/gh run watch [^\n]*--exit-status/);
    // `released.mjs` imports changesets' reader, so it runs after an install,
    // and before the wait, so a version still owed refuses in seconds.
    const steps = ['yarn install --immutable', 'tools/released.mjs --lockstep', 'gh run watch'];
    const at = steps.map((step) => green.indexOf(step));
    expect(at.every((index) => index > -1), `green runs ${steps.join(', then ')}`).toBe(true);
    expect([...at].sort((one, other) => one - other)).toEqual(at);
    expect(green).toMatch(/timeout-minutes: \d+/);
    expect(job('publish')).toMatch(/needs: \[green, native, editors\]/);
    expect(WORKFLOW).not.toMatch(/yarn verify\s*$/m);
  });

  // npm no longer issues a token that publishes without a second factor, so a
  // token in this job cannot publish: it answers YN0033, or 404 once it expires.
  // The run's OIDC token is the credential, and Yarn trades it only when no
  // other is set (ADR-0060).
  it('publishes through the trusted publisher, with no npm token to set', () => {
    expect(job('publish')).toMatch(/id-token: write/);
    expect(WORKFLOW).not.toMatch(/YARN_NPM_AUTH_TOKEN|NPM_TOKEN/);
  });

  // The `native` matrix built every platform's scanner. `yarn build` would
  // compile the runner's own again, minutes of cargo for a binary the download
  // overwrites.
  it('builds the TypeScript for a publish, and takes the scanners from the matrix', () => {
    expect(job('publish')).toMatch(/- run: yarn build:js\s*$/m);
    expect(job('publish')).not.toMatch(/- run: yarn build\s*$/m);
  });

  it('tags from a step that can fail, and checks the tags arrived', () => {
    expect(WORKFLOW).toContain('yarn changeset tag');
    expect(WORKFLOW).toContain('git push origin --tags');
    // The last word belongs to the check that reads both halves — no
    // `--registry`, so the tags are read too.
    const after = WORKFLOW.slice(WORKFLOW.lastIndexOf('git push origin --tags'));
    expect(after).toMatch(/tools\/released\.mjs --wait \d+\s*$/m);
  });
});
