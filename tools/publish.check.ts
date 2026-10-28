import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain script, run by the workflow and by hand; no types to import.
import { askedFor, npmArguments, PARALLEL, placeholders, planOf, publish, untrusted } from './publish.mjs';

/**
 * What `changeset pack` packed reaches the registry through `npm publish`.
 *
 * Yarn's sigstore client gives the transparency log five seconds, then resends
 * the same signed envelope and reads the log's "an equivalent entry already
 * exists" as a failure: 0.17.1 and 0.18.0 lost names to it on every attempt.
 * npm hands the same client its five-minute `fetch-timeout`. Nothing here
 * reaches the network or npm; the registry and the command are handed in.
 */
interface Release {
  readonly kind: string;
  readonly name: string;
  readonly version: string;
  readonly tag?: string;
  readonly access?: string;
  readonly tarball?: { readonly path: string };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function packed(plan: readonly (readonly Release[])[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'packed-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'publish-plan.json'), JSON.stringify({ version: 1, plan }));
  return dir;
}

const release = (name: string): Release => ({
  kind: 'publish',
  name,
  version: '1.2.3',
  tag: 'latest',
  access: 'public',
  tarball: { path: `packages/${name}.tgz` },
});

describe('publishing a packed release', () => {
  it('reads the groups changesets planned, and only what it plans to publish', () => {
    const dir = packed([[release('a'), { kind: 'tag-only', name: 'z', version: '1.2.3' }], [release('b')]]);
    expect((planOf(dir) as Release[][]).map((group) => group.map((entry) => entry.name))).toEqual([['a'], ['b']]);
  });

  it('refuses a plan it does not know the shape of', () => {
    const dir = packed([]);
    writeFileSync(join(dir, 'publish-plan.json'), JSON.stringify({ version: 2, plan: [] }));
    expect(() => planOf(dir)).toThrow(/version 1 publish plan/);
  });

  it('publishes the tarball with npm, signed, at the tag and access changesets planned', () => {
    const dir = packed([]);
    expect(npmArguments(dir, release('a'))).toEqual([
      'publish',
      join(dir, 'packages/a.tgz'),
      '--access',
      'public',
      '--tag',
      'latest',
      '--provenance',
    ]);
  });

  it('skips what the registry holds, and publishes groups in order', async () => {
    const dir = packed([[release('a'), release('b')], [release('c')]]);
    const sent: string[] = [];
    const failed = await publish(dir, {
      registry: async (name: string) => name === 'a',
      npm: async (args: readonly string[]) => void sent.push(String(args[1])),
    });
    expect(failed).toEqual([]);
    expect(sent).toEqual([join(dir, 'packages/b.tgz'), join(dir, 'packages/c.tgz')]);
  });

  // What depends on a name that failed would be installable before it is, so it
  // waits for the next attempt, as `changeset publish` waits.
  it('finishes the group a name failed in, and attempts nothing after it', async () => {
    const dir = packed([[release('a'), release('b')], [release('c')]]);
    const sent: string[] = [];
    const failed = await publish(dir, {
      registry: async () => false,
      npm: async (args: readonly string[]) => {
        sent.push(String(args[1]));
        if (String(args[1]).endsWith('a.tgz')) throw new Error('409');
      },
    });
    expect(failed).toEqual(['a@1.2.3']);
    expect(sent.sort()).toEqual([join(dir, 'packages/a.tgz'), join(dir, 'packages/b.tgz')]);
  });

  it('sends at most ten at once, and a registry that cannot answer fails the name', async () => {
    const names = Array.from({ length: 25 }, (_, index) => `n${index}`);
    const dir = packed([names.map(release)]);
    // Each publish waits at a gate, and the gates open only once every worker
    // is waiting, or the last name has started: more than ten never arrive.
    const gates: (() => void)[] = [];
    let running = 0;
    let started = 0;
    let most = 0;
    const failed = await publish(dir, {
      registry: async (name: string) => {
        if (name === 'n3') throw new Error('registry answered 503');
        return false;
      },
      npm: async () => {
        started += 1;
        most = Math.max(most, ++running);
        const gate = new Promise<void>((open) => gates.push(open));
        if (running === PARALLEL || started === names.length - 1) for (const open of gates.splice(0)) open();
        await gate;
        running -= 1;
      },
    });
    expect(PARALLEL).toBe(10);
    expect(most).toBe(PARALLEL);
    expect(failed).toEqual(['n3@1.2.3']);
  });

  // npm holds a version it accepted while it scans it, and a second publish
  // of it is refused: that refusal says the version is npm's, not that it
  // failed. 0.19.0's retry read it as a failure and held the group behind it.
  it('counts a version npm already holds as sent, and any other refusal as a failure', async () => {
    const dir = packed([[release('a'), release('b')], [release('c')]]);
    const sent: string[] = [];
    const failed = await publish(dir, {
      registry: async () => false,
      npm: async (args: readonly string[]) => {
        sent.push(String(args[1]));
        if (String(args[1]).endsWith('a.tgz')) {
          throw Object.assign(new Error('npm exited 1'), {
            stderr: 'npm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/a - Cannot publish over previously staged version "1.2.3".\n',
          });
        }
        if (String(args[1]).endsWith('b.tgz')) {
          throw Object.assign(new Error('npm exited 1'), { stderr: 'npm error code E500\n' });
        }
      },
    });
    expect(failed).toEqual(['b@1.2.3']);
    expect(sent.sort()).toEqual([join(dir, 'packages/a.tgz'), join(dir, 'packages/b.tgz')]);
  });

  it('goes on past a version npm already holds', async () => {
    const dir = packed([[release('a')], [release('c')]]);
    const sent: string[] = [];
    const failed = await publish(dir, {
      registry: async () => false,
      npm: async (args: readonly string[]) => {
        sent.push(String(args[1]));
        if (String(args[1]).endsWith('a.tgz')) {
          throw Object.assign(new Error('npm exited 1'), {
            stderr: 'npm error 409 Conflict - PUT x - Cannot publish over previously staged version "1.2.3".\n',
          });
        }
      },
    });
    expect(failed).toEqual([]);
    expect(sent).toEqual([join(dir, 'packages/a.tgz'), join(dir, 'packages/c.tgz')]);
  });
});

// npm adds a trusted publisher only to a package that exists, so a new name is
// created by hand, once. What is created is a manifest at a version no release
// carries: the real version still ships from the workflow, signed, after the
// siblings it depends on, and creating it needs no build and no platform's
// binary.
describe('creating a name npm has never held', () => {
  it('publishes a placeholder of each new name, then trusts the release workflow with it', async () => {
    const ran: string[][] = [];
    let manifest: unknown;
    const created = await placeholders(['brand-new'], {
      registry: async () => false,
      npm: async (args: readonly string[]) => {
        ran.push([...args]);
        if (args[0] === 'publish') manifest = JSON.parse(readFileSync(join(String(args[1]), 'package.json'), 'utf8'));
      },
    });
    expect(created).toEqual(['brand-new']);
    const [published, trusted] = ran;
    expect(published?.slice(0, 1)).toEqual(['publish']);
    expect(published?.slice(2)).toEqual(['--access', 'public', '--tag', 'placeholder']);
    expect(manifest).toMatchObject({ name: 'brand-new', version: '0.0.0-placeholder.0' });
    expect(trusted).toEqual([
      'trust',
      'github',
      'brand-new',
      '--file',
      'release.yml',
      '--repo',
      'Variance-Authority/variance-authority',
      '--env',
      'npm',
      '--allow-publish',
      '--yes',
    ]);
  });

  it('stops at the first name that fails, trusts nothing it did not create, and names what is left', async () => {
    const ran: string[][] = [];
    const refused = placeholders(['a', 'b'], {
      registry: async () => false,
      npm: async (args: readonly string[]) => {
        ran.push([...args]);
        if (args[0] === 'publish') throw new Error('npm publish exited 1');
      },
    });
    await expect(refused).rejects.toThrow(/exited 1/);
    await expect(refused).rejects.toMatchObject({ unfinished: ['a', 'b'] });
    expect(ran.map((args) => args[0])).toEqual(['publish']);
  });

  it('finishes a name npm already holds by trusting it, without publishing onto it', async () => {
    const ran: string[][] = [];
    const created = await placeholders(['shown', 'staged'], {
      registry: async (name: string, version?: string) => name === 'shown' && version === undefined,
      npm: async (args: readonly string[]) => {
        ran.push([...args]);
        if (args[0] === 'publish') {
          throw Object.assign(new Error('npm publish exited 1'), {
            stderr: 'npm error 409 Conflict - Cannot publish over previously staged version',
          });
        }
      },
    });
    expect(created).toEqual(['shown', 'staged']);
    expect(ran.map((args) => args.slice(0, 3).join(' '))).toEqual([
      'trust github shown',
      `publish ${ran[1]?.[1]} --access`,
      'trust github staged',
    ]);
  });

  it('refuses a name this repository does not publish, or a flag, before anything reaches npm', () => {
    const packages = [{ name: '@variance-authority/isolator' }];
    expect(askedFor(['@variance-authority/isolator'], packages)).toEqual(['@variance-authority/isolator']);
    expect(() => askedFor(['isolater'], packages)).toThrow(/isolater[\s\S]*@variance-authority\/isolator/);
    expect(() => askedFor(['--help'], packages)).toThrow(/--help/);
  });

  it('reads a workflow publish refused for want of a login as a name with no trusted publisher', () => {
    expect(untrusted({ stderr: 'npm error code ENEEDAUTH' })).toBe(true);
    expect(untrusted({ stderr: 'npm error code E403' })).toBe(false);
  });
});
