import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain script, run by the workflow and by hand; no types to import.
import { npmArguments, PARALLEL, planOf, publish } from './publish.mjs';

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
});
