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

  // The retry is the repair: the publisher skips versions the registry already
  // holds, so the command that truncated a release is the command that
  // finishes it. Its exit code ends nothing: 0.17.1 lost two names, `bash -e`
  // stopped there, and the retry written for exactly that never ran. And the
  // retry comes in rounds for as long as rounds finish names, because a name
  // that fails holds what depends on it: 0.18.0 went 41, 34, 27, 22, 14
  // missing and stopped at a cap of three with every round still finishing
  // names. A round that publishes nothing is the stop.
  it('asks the registry what published, and finishes what did not', () => {
    const publish = job('publish');
    const attempts = publish.match(/^ *node tools\/publish\.mjs.*$/gm) ?? [];
    expect(attempts.length).toBe(2);
    expect(attempts.every((line) => /node tools\/publish\.mjs "\$PACKED" \|\|/.test(line)), attempts.join('\n')).toBe(true);
    expect(publish).not.toMatch(/for round in \d/);
    expect(publish).toMatch(/left=\$\(node tools\/released\.mjs --count --wait \d+\)/);
    expect(publish).toMatch(/while \[ "\$left" -gt 0 \]; do\n[^]*?tools\/publish\.mjs[^]*?released\.mjs --count[^]*?-lt "\$left"[^]*?done/);
    // The verdict after the rounds stands alone: nothing may excuse it.
    expect(publish).toMatch(/done\n *node tools\/released\.mjs --registry --wait \d+$/m);
  });

  // Yarn packs, because `yarn pack` rewrites `workspace:^` and runs each
  // `prepack`; npm publishes, because Yarn's signing client gives the
  // transparency log five seconds and reads its own retry's conflict as a
  // failure (ADR-0060).
  it('packs with changesets and publishes with npm, never with Yarn', () => {
    const publish = job('publish');
    expect(publish).toMatch(/yarn changeset pack --out-dir "\$PACKED"/);
    expect(publish.indexOf('changeset pack')).toBeLessThan(publish.indexOf('node tools/publish.mjs'));
    expect(WORKFLOW).not.toMatch(/^\s*(yarn )?changeset publish\b|yarn npm publish|release:publish/m);
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
  // token in this job cannot publish: it is refused, or 404s once it expires.
  // The run's OIDC token is the credential, and npm trades it only when no
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
