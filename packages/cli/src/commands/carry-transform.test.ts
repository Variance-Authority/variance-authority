import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carryPlan, carryText, githubOutput, type HostRun } from './carry.js';
import { isoWeek } from './carry-transform.js';

const SHA = 'c'.repeat(40);
const PUSH: HostRun = { event: 'push', sha: SHA, ref: 'refs/heads/main', run: '7', attempt: '1' };
const PULL: HostRun = { event: 'pull_request', sha: SHA, ref: 'refs/pull/3/merge', baseRef: 'main', run: '8', attempt: '2' };
const SUITES = [{ name: 'unit', kind: 'unit', carry: 'actions-cache' }] as const;
const MAINLINES = { names: ['main', 'release/2'] } as const;
// A Thursday in ISO week 47 of 2026.
const NOW = new Date('2026-11-19T12:00:00Z');

let jest: string;
let bare: string;

beforeAll(async () => {
  // A project whose root resolves `jest-config`, as one with Jest installed does.
  jest = await mkdtemp(join(tmpdir(), 'variance-carry-jest-'));
  const config = join(jest, 'node_modules', 'jest-config');
  await mkdir(config, { recursive: true });
  await writeFile(join(jest, 'package.json'), '{"name":"project"}');
  await writeFile(join(config, 'package.json'), '{"name":"jest-config","main":"index.js"}');
  await writeFile(join(config, 'index.js'), "exports.defaults = { cacheDirectory: '/tmp/jest_rs' };");
  bare = await mkdtemp(join(tmpdir(), 'variance-carry-bare-'));
  await writeFile(join(bare, 'package.json'), '{"name":"project"}');
});

afterAll(async () => {
  await rm(jest, { recursive: true, force: true });
  await rm(bare, { recursive: true, force: true });
});

const restore = (root: string, run: HostRun, extra: { shard?: { index: number; total: number }; now?: Date } = {}) =>
  carryPlan({ direction: 'restore', root, suites: SUITES, run, mainlines: MAINLINES, now: NOW, ...extra });

describe("Jest's transform cache", () => {
  it("is restored to the path Jest's own jest-config answers, keyed by suite, shard and week", () => {
    const plan = restore(jest, PULL, { shard: { index: 2, total: 3 } });

    expect(plan.cached.find((cached) => cached.artifact === 'transform-unit')).toEqual({
      artifact: 'transform-unit',
      paths: ['/tmp/jest_rs'],
      key: 'variance-transform-unit-2of3:main:2026-W47',
      restoreKeys: ['variance-transform-unit-2of3:release/2:2026-W47'],
    });
    expect(githubOutput(plan)).toContain('transform-unit-key=variance-transform-unit-2of3:main:2026-W47\n');
  });

  it('gives each shard and each week its own key, and restores nothing from an earlier week', () => {
    const key = (shard: { index: number; total: number } | undefined, now: Date): string | undefined =>
      restore(jest, PUSH, { ...(shard === undefined ? {} : { shard }), now }).cached.find((cached) => cached.artifact === 'transform-unit')?.key;
    const one = key({ index: 1, total: 3 }, NOW);
    const two = key({ index: 2, total: 3 }, NOW);
    const later = key({ index: 1, total: 3 }, new Date('2026-11-23T00:00:00Z'));

    expect(new Set([one, two, later]).size).toBe(3);
    expect(key(undefined, NOW)).toBe('variance-transform-unit:main:2026-W47');
    const keys = restore(jest, PUSH, { now: new Date('2026-11-23T00:00:00Z') }).cached.find((cached) => cached.artifact === 'transform-unit');
    expect([keys?.key, ...(keys?.restoreKeys ?? [])].every((each) => each?.endsWith(':2026-W48'))).toBe(true);
  });

  it('prints no transform output where jest-config does not resolve, and says why', () => {
    const plan = restore(bare, PUSH);

    expect(plan.cached.some((cached) => cached.artifact.startsWith('transform-'))).toBe(false);
    expect(githubOutput(plan)).not.toContain('transform-');
    expect(carryText(plan)).toContain("no Jest's transform cache is carried: jest-config does not resolve from");
  });

  it('is not saved by `carry save`, whose host step is the cache action restoring it', () => {
    const plan = carryPlan({ direction: 'save', root: jest, suites: SUITES, run: PULL, mainlines: MAINLINES, now: NOW });

    expect(plan.cached.some((cached) => cached.artifact.startsWith('transform-'))).toBe(false);
  });
});

describe('the ISO week', () => {
  it('starts on Monday, and the days of a year before its first Thursday belong to the year before', () => {
    expect(isoWeek(new Date('2026-11-22T23:59:59Z'))).toBe('2026-W47');
    expect(isoWeek(new Date('2026-11-23T00:00:00Z'))).toBe('2026-W48');
    expect(isoWeek(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
    expect(isoWeek(new Date('2024-12-30T00:00:00Z'))).toBe('2025-W01');
  });
});
