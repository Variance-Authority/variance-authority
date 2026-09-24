import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain script, run by the workflow and by hand; no types to import.
import { lockstep, publishable } from './released.mjs';

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

  it('tags from a step that can fail, and checks the tags arrived', () => {
    expect(WORKFLOW).toContain('yarn changeset tag');
    expect(WORKFLOW).toContain('git push origin --tags');
    // The last word belongs to the check that reads both halves — no
    // `--registry`, so the tags are read too.
    const after = WORKFLOW.slice(WORKFLOW.lastIndexOf('git push origin --tags'));
    expect(after).toMatch(/tools\/released\.mjs --wait \d+\s*$/m);
  });
});
