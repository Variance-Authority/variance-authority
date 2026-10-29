import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- a plain script, run by the workflow and by hand; no types to import.
import { lockstep, missing, onRegistry, publishable, releaseTags, unborn, waiting } from './released.mjs';

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

  // One 503 in a wait that spans npm's scan would end a release the next poll
  // would have counted.
  it('asks again a registry that did not answer, and refuses one that never does', async () => {
    const entries = [{ name: 'a' }, { name: 'b' }];
    const asked: string[] = [];
    const flaky = async (name: string) => {
      asked.push(name);
      if (name === 'a' && asked.filter((one) => one === 'a').length === 1) throw new Error('a answered 503');
      return true;
    };
    expect(await missing(entries, '1.2.3', 60, { ask: flaky, everyMs: 0 })).toEqual([]);
    expect(asked).toEqual(['a', 'b', 'a']);
    const down = async () => {
      throw new Error('answered 503');
    };
    await expect(missing(entries, '1.2.3', 0, { ask: down, everyMs: 0 })).rejects.toThrow(/answered 503/);
  });

  // npm adds a trusted publisher to a package that exists, so a name it has
  // never held cannot be created by the workflow: 0.20.0 reached the first ten
  // names and stopped at `jest-transformer` with ENEEDAUTH. Asked before the
  // first publish, the release refuses whole instead of in part.
  it('names every package the registry has never held', async () => {
    const entries = [{ name: 'held' }, { name: 'new' }, { name: 'also-new' }];
    const ask = async (name: string) => name === 'held';
    expect(await unborn(entries, { ask })).toEqual([{ name: 'new' }, { name: 'also-new' }]);
    const down = async () => {
      throw new Error('answered 503');
    };
    await expect(unborn(entries, { ask: down })).rejects.toThrow(/answered 503/);
  });

  describe('asking the registry', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });
    const answering = (status: number) => {
      const asked: string[] = [];
      vi.stubGlobal('fetch', async (at: string) => {
        asked.push(at);
        return new Response(null, { status });
      });
      return asked;
    };

    it('asks for one version, or for the name at all', async () => {
      const asked = answering(200);
      expect(await onRegistry('@variance-authority/core', '1.2.3')).toBe(true);
      expect(await onRegistry('@variance-authority/core')).toBe(true);
      expect(asked).toEqual([
        'https://registry.npmjs.org/@variance-authority%2fcore/1.2.3',
        'https://registry.npmjs.org/@variance-authority%2fcore',
      ]);
    });

    it('reads a 404 as not held, and refuses any other answer', async () => {
      answering(404);
      expect(await onRegistry('brand-new')).toBe(false);
      answering(503);
      await expect(onRegistry('brand-new')).rejects.toThrow(/answered 503/);
    });
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

  // npm answers a publish when it has accepted the version, not when it shows
  // it: 0.19.0 accepted `core` and showed it minutes later, after a scan. A
  // second publish of a version npm holds is refused with 409 "previously
  // staged" forever, so a retry cannot finish anything; it only stopped the
  // round behind it. One publish, then the registry, given the scan's time,
  // is the verdict, and nothing may excuse it.
  it('publishes once, and asks the registry what published', () => {
    const publish = job('publish');
    const attempts = publish.match(/^ *node tools\/publish\.mjs.*$/gm) ?? [];
    expect(attempts).toEqual([expect.stringMatching(/^ *node tools\/publish\.mjs "\$PACKED"$/)]);
    expect(publish).not.toMatch(/\bwhile\b|\bfor round\b|--count/);
    const verdict = /^ *node tools\/publish\.mjs "\$PACKED"\n(?: *#.*\n| *\n)* *node tools\/released\.mjs --registry --wait (\d+)$/m.exec(publish);
    expect(verdict, 'the registry check follows the publish').not.toBeNull();
    expect(Number(verdict?.[1])).toBeGreaterThanOrEqual(1200);
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
    const steps = ['yarn install --immutable', 'tools/released.mjs --lockstep', 'tools/released.mjs --named', 'gh run watch'];
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

  // An adopter's workflow names the composite action by a ref, and the ref is
  // the version of the CLI it runs, such as `@v0.21.0`. The
  // package tags carry a scope and a second `@`, which no `uses:` line should.
  it('is tagged once per package and once for the repository', () => {
    const tags = releaseTags(publishable(), '1.2.3') as readonly string[];
    expect(tags).toContain('@variance-authority/cli@1.2.3');
    expect(tags).toContain('v1.2.3');
    expect(tags).toHaveLength(publishable().length + 1);
  });

  it('pushes the repository tag beside the package tags', () => {
    const tagging = WORKFLOW.slice(WORKFLOW.indexOf('yarn changeset tag'), WORKFLOW.lastIndexOf('git push origin --tags'));
    expect(tagging).toContain('git tag -a "v$version"');
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
