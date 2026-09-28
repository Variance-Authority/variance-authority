import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { repositoryLayers } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCarryArgs } from '../carry-args.js';
import type { Config } from '../config.js';
import { baseOf, carryPlan, carryText, githubOutput, hostRunOf, lineOf, type HostRun } from './carry.js';

const SHA = 'c'.repeat(40);
const BASE = 'b'.repeat(40);
const UNIT = [{ name: 'unit', kind: 'unit', carry: 'actions-cache' }] as const;
const PUSH: HostRun = { event: 'push', sha: SHA, ref: 'refs/heads/main', run: '7', attempt: '1', base: BASE };
const PULL: HostRun = { event: 'pull_request', sha: SHA, ref: 'refs/pull/3/merge', baseRef: 'main', run: '8', attempt: '2', base: BASE };
const MAIN = { names: ['main'] } as const;

let root: string;
let cache: string;
let previous: string | undefined;
let layer: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-carry-'));
  cache = await mkdtemp(join(tmpdir(), 'variance-carry-cache-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  execFileSync('git', ['init', '--quiet', root]);
  layer = repositoryLayers(root).top;
});

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(root, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
});

/** The placement fields `carry` reads, and nothing it does not. */
const project = (overrides: Partial<Config> = {}): Config =>
  ({
    project: 'shop',
    report: '/r/.variance/run.json',
    images: '/r/.variance/images',
    baselines: { kind: 'directory', root: '/r/.variance/baselines', carry: 'actions-cache' },
    ...overrides,
  }) as unknown as Config;

describe('the line a key is cut for', () => {
  it('is the branch a pull request targets, and the branch a push lands on', () => {
    expect(lineOf(PULL)).toBe('main');
    expect(lineOf(PUSH)).toBe('main');
    expect(lineOf({ event: 'push', ref: 'refs/tags/v1' })).toBeUndefined();
    expect(hostRunOf({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_BASE_REF: '' })).toEqual({
      event: 'push',
      ref: 'refs/heads/main',
    });
  });
});

describe('a recording', () => {
  it('restores from the base on its line, then the newest there, then another mainline', () => {
    const plan = carryPlan({ direction: 'restore', root, suites: UNIT, run: PULL, mainlines: { names: ['main', 'release/2'] } });
    const prefix = `variance-suite-unit-${basename(layer)}`;

    expect(plan.cached).toEqual([
      {
        artifact: 'suite-unit',
        paths: [layer, `!${layer}/**/.run-*`, `!${layer}/.work`],
        key: `${prefix}:main:${BASE}`,
        // `main-2`'s keys begin `…:main-2:`, which no prefix here matches.
        restoreKeys: [`${prefix}:main:${BASE}-`, `${prefix}:main:`, `${prefix}:release/2:`],
      },
    ]);
  });

  it('saves on a push to a mainline, under the run, because a cache key is never overwritten', () => {
    const plan = carryPlan({ direction: 'save', root, suites: UNIT, run: PUSH, mainlines: MAIN });

    expect(plan.cached.map((one) => one.key)).toEqual([`variance-suite-unit-${basename(layer)}:main:${SHA}-7-1`]);
    expect(plan.notes).toEqual([]);
  });

  it('is not saved from a pull request, and the plan says so', () => {
    const plan = carryPlan({ direction: 'save', root, suites: UNIT, run: PULL, mainlines: MAIN });

    expect(plan.cached).toEqual([]);
    expect(plan.notes).toEqual(['suite-unit is not saved: only a push to a mainline (main) saves a recording']);
    expect(githubOutput(plan)).not.toContain('suite-unit-key');
  });

  it('is not saved when no mainline is known, naming the answers that were missing', () => {
    const plan = carryPlan({ direction: 'save', root, suites: UNIT, run: PUSH, mainlines: { missing: ['config', 'remote-head', 'event'] } });

    expect(plan.cached).toEqual([]);
    expect(plan.notes).toEqual([
      'suite-unit is not saved: no mainline is known, and these answers were missing: config, remote-head, event',
    ]);
  });
});

describe('baselines and a report', () => {
  it('restore by this commit and then the newest on the line, with the paths the config names', () => {
    const plan = carryPlan({
      direction: 'restore',
      root,
      config: project({ reportCarry: 'actions-cache' }),
      run: PULL,
      mainlines: MAIN,
    });

    expect(plan.cached).toEqual([
      {
        artifact: 'baselines',
        paths: ['/r/.variance/baselines'],
        key: `variance-shop-baselines:main:${SHA}`,
        restoreKeys: [`variance-shop-baselines:main:${SHA}-`, 'variance-shop-baselines:main:'],
      },
      {
        artifact: 'report',
        paths: ['/r/.variance/run.json', '/r/.variance/images'],
        key: `variance-shop-report:main:${SHA}`,
        restoreKeys: [`variance-shop-report:main:${SHA}-`, 'variance-shop-report:main:'],
      },
    ]);
  });

  it('leave what `share` carries to `share`, and say so', () => {
    const plan = carryPlan({
      direction: 'save',
      root,
      config: project({ reportCarry: 'share' }),
      suites: [{ name: 'stories', kind: 'visual', carry: 'share' }],
      run: PULL,
      mainlines: MAIN,
    });

    expect(plan.cached.map((one) => one.key)).toEqual([`variance-shop-baselines:main:${SHA}-8-2`]);
    expect(plan.notes).toEqual(['the report is carried by `variance share`', 'suite stories is carried by `variance share`']);
  });

  it('have no key off a host run, and the plan says why', () => {
    const plan = carryPlan({ direction: 'restore', root, config: project(), run: {}, mainlines: MAIN });

    expect(plan.cached).toEqual([]);
    expect(plan.notes).toEqual(['baselines is carried by the host cache, and this is not a host run, so it has no key here']);
    expect(carryText(plan)).toContain('carry restore, off a host run');
  });
});

describe('the output the host reads', () => {
  it('writes lists as heredocs and every upload as a path', () => {
    const plan = carryPlan({ direction: 'restore', root, config: project(), run: PULL, mainlines: MAIN });

    expect(githubOutput(plan).split('\n')).toEqual([
      'line=main',
      `base=${BASE}`,
      'baselines-path<<VARIANCE_CARRY_END',
      '/r/.variance/baselines',
      'VARIANCE_CARRY_END',
      `baselines-key=variance-shop-baselines:main:${SHA}`,
      'baselines-restore-keys<<VARIANCE_CARRY_END',
      `variance-shop-baselines:main:${SHA}-`,
      'variance-shop-baselines:main:',
      'VARIANCE_CARRY_END',
      'baselines-root=/r/.variance/baselines',
      'report=/r/.variance/run.json',
      'images=/r/.variance/images',
      `review=${join(root, '.variance/review')}`,
      '',
    ]);
  });

  it('refuses a path with a line break, which would write an output of its own', () => {
    const plan = carryPlan({ direction: 'restore', root, config: project({ images: '/r/x\nreport-key=forged' }), run: PULL, mainlines: MAIN });

    expect(() => githubOutput(plan)).toThrow(/line break/);
  });

  it('names the store a commit-back stages, whoever carries it, and no store the checkout does not hold', () => {
    const committed = carryPlan({
      direction: 'save',
      root,
      config: project({ baselines: { kind: 'lfs', root: '/r/baselines' } } as Partial<Config>),
      run: PULL,
      mainlines: MAIN,
    });
    const remote = carryPlan({
      direction: 'save',
      root,
      config: project({ baselines: { kind: 'remote', endpoint: 'https://store.test' } } as Partial<Config>),
      run: PULL,
      mainlines: MAIN,
    });

    expect(githubOutput(committed)).toContain('\nbaselines-root=/r/baselines\n');
    expect(committed.cached).toEqual([]);
    expect(githubOutput(remote)).not.toContain('baselines-root');
  });
});

describe('the base a recording is restored from', () => {
  it('is the commit a push replaced when the checkout holds it, and one commit back otherwise', async () => {
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'one');
    const one = git('rev-parse', 'HEAD');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'two');
    const two = git('rev-parse', 'HEAD');
    const event = join(root, 'event.json');

    await writeFile(event, JSON.stringify({ before: two }));
    expect(await baseOf(root, { event: 'push' }, event)).toBe(two);
    // A force-push can name a commit the shallow checkout never fetched.
    await writeFile(event, JSON.stringify({ before: 'f'.repeat(40) }));
    expect(await baseOf(root, { event: 'push' }, event)).toBe(one);
    await writeFile(event, JSON.stringify({ before: '0'.repeat(40) }));
    expect(await baseOf(root, { event: 'push' }, event)).toBe(one);
  });
});

describe('the arguments', () => {
  it('take the direction first, and refuse a third one', () => {
    const parse = (...argv: string[]) => parseCarryArgs(readFlags(argv, 'carry', ['--config', '--format']));

    expect(parse('save', '--format', 'github')).toEqual({ command: 'carry', direction: 'save', format: 'github' });
    expect(() => parse()).toThrow('`carry` needs a direction');
    expect(() => parse('upload')).toThrow('`carry` restores or saves, not `upload`');
    expect(() => parse('save', '--format', 'json')).toThrow('--format must be text or github');
  });
});
