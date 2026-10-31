import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  encodeExecutionIndex,
  recordedEyesAt,
  repositoryLayers,
  testCoverageFile,
  writeTestCoverage,
} from '@variance-authority/sense/test-selection';
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
const PARTITION = `v1[-:]${'[0-9a-f]'.repeat(32)}`;

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
  // The suites a save is planned for, declared as a real root config declares them.
  await writeFile(join(root, 'variance.config.json'), JSON.stringify({ suites: {
    unit: { kind: 'unit', carry: 'actions-cache' },
    chromium: { kind: 'e2e', carry: 'actions-cache' },
    seen: { kind: 'e2e', carry: 'actions-cache' },
  } }));
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

  it('names the Eyes journals a saved record carries, because the cache takes them off this machine', async () => {
    const record = testCoverageFile(root, { suite: 'seen' });
    await mkdir(dirname(record), { recursive: true });
    const id = 'test/cart.spec.ts > adds one item';
    const eyes = { watched: [id], journals: [{ case: id, attempt: 1, journal: { complete: true, attention: [] } }] };
    await writeTestCoverage(
      record,
      { version: 3, instrumentation: 'fixture', tests: [], modules: [] },
      {
        index: encodeExecutionIndex({ tests: [{ id, file: 'test/cart.spec.ts', name: 'adds one item' }], modules: [] }),
        eyes: Buffer.from(`${JSON.stringify({ version: 1, ...eyes })}\n`),
      },
    );
    const suites = [{ name: 'seen', kind: 'e2e', carry: 'actions-cache' }] as const;

    try {
      const plan = carryPlan({ direction: 'save', root, suites, run: PUSH, mainlines: MAIN });
      expect(plan.notes).toEqual([
        `suite seen carries its cases' Eyes journals: the eyes section of ${record} goes into the cache with it`,
      ]);
      // What the cache is given is the record under the layer, whose bytes keep the journal.
      const [saved] = plan.cached;
      expect(saved?.paths[0]).toBe(layer);
      expect(record.startsWith(`${layer}/`)).toBe(true);
      expect(recordedEyesAt(record)).toEqual(eyes);
      // A restore brings back what a mainline already gave the cache, and uploads nothing.
      expect(carryPlan({ direction: 'restore', root, suites, run: PUSH, mainlines: MAIN }).notes).toEqual([]);
    } finally {
      await rm(record);
    }
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

  it('restore, on a line that saves none, what a mainline saved, as a recording does', () => {
    const into = (mainlines: Parameters<typeof carryPlan>[0]['mainlines']) =>
      carryPlan({
        direction: 'restore',
        root,
        config: project({ reportCarry: 'actions-cache' }),
        run: { ...PULL, baseRef: 'feat/stacked' },
        mainlines,
      }).cached.map((one) => one.restoreKeys);

    expect(into({ names: ['main', 'release/2'] })).toEqual([
      [
        `variance-shop-baselines:feat/stacked:${SHA}-`,
        'variance-shop-baselines:feat/stacked:',
        'variance-shop-baselines:main:',
        'variance-shop-baselines:release/2:',
      ],
      [
        `variance-shop-report:feat/stacked:${SHA}-`,
        'variance-shop-report:feat/stacked:',
        'variance-shop-report:main:',
        'variance-shop-report:release/2:',
      ],
    ]);
    // With no mainline known, there is none to fall back to.
    expect(into({ missing: ['config', 'remote-head', 'event'] })).toEqual([
      [`variance-shop-baselines:feat/stacked:${SHA}-`, 'variance-shop-baselines:feat/stacked:'],
      [`variance-shop-report:feat/stacked:${SHA}-`, 'variance-shop-report:feat/stacked:'],
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
      'project=shop',
      'baselines-path<<VARIANCE_CARRY_END',
      '/r/.variance/baselines',
      'VARIANCE_CARRY_END',
      `baselines-key=variance-shop-baselines:main:${SHA}`,
      'baselines-restore-keys<<VARIANCE_CARRY_END',
      `variance-shop-baselines:main:${SHA}-`,
      'variance-shop-baselines:main:',
      'VARIANCE_CARRY_END',
      'baselines-root=/r/.variance/baselines',
      'baselines-pathspecs<<VARIANCE_CARRY_END',
      ':(glob)/r/.variance/baselines/**/*-*.webp',
      ':(glob)/r/.variance/baselines/**/*-*.png',
      ':(glob)/r/.variance/baselines/**/*-*.json',
      `:(glob)/r/.variance/baselines/**/${PARTITION}/*`,
      'VARIANCE_CARRY_END',
      'report=/r/.variance/run.json',
      'images=/r/.variance/images',
      `review=${join(root, '.variance/review')}`,
      '',
    ]);
  });

  it('names the project as one path segment, which a ref and an artifact name both take as it is', () => {
    // A ref per project and a report page per project are named with it, so two
    // projects never share one, and a project is one segment whatever it is
    // spelled with: a slash would make cleanup miss the ref, a space or a colon
    // would make git refuse it, and `..` or a leading dot either.
    const projects = ['storybook-case', 'tribunal', 'web_2', '@acme/web', 'a b', 'a-b', 'a.b', 'a%2Eb', '..', 'a:b~c', 'café'];
    const segments = projects.map(
      (name) => /^project=(.*)$/mu.exec(githubOutput(carryPlan({ direction: 'restore', root, config: project({ project: name }), run: PULL, mainlines: MAIN })))?.[1],
    );

    expect(segments.slice(0, 3)).toEqual(['storybook-case', 'tribunal', 'web_2']);
    for (const segment of segments) expect(segment).toMatch(/^[A-Za-z0-9_%-]+$/u);
    expect(new Set(segments).size).toBe(projects.length);
    expect(githubOutput(carryPlan({ direction: 'restore', root, suites: UNIT, run: PULL, mainlines: MAIN }))).not.toContain('project=');
  });

  it('refuses a project holding a lone surrogate, which would be spelled as the replacement character is', () => {
    const plan = (name: string) => carryPlan({ direction: 'restore', root, config: project({ project: name }), run: PULL, mainlines: MAIN });

    expect(() => plan('a\ud800')).toThrow(/lone surrogate/);
    expect(plan('a\ufffd').project).toBe('a%EF%BF%BD');
  });

  it('names the suites given to the share, in the order they are given, and no other', () => {
    const suites = [
      { name: 'unit', kind: 'unit', carry: 'share' },
      { name: 'chromium', kind: 'e2e', carry: 'actions-cache' },
      { name: 'integration', kind: 'integration', carry: 'share' },
      { name: 'local', kind: 'unit' },
    ] as const;
    const plan = carryPlan({ direction: 'restore', root, suites, run: PULL, mainlines: MAIN });

    expect(plan.shared).toEqual(['unit', 'integration']);
    expect(githubOutput(plan)).toContain('\nshared-suites=unit integration\n');
    expect(githubOutput(carryPlan({ direction: 'restore', root, suites: UNIT, run: PULL, mainlines: MAIN }))).not.toContain('shared-suites');
  });

  it('refuses a shared suite whose name holds a space, which the loop reading it would split', () => {
    const plan = carryPlan({ direction: 'restore', root, suites: [{ name: 'two words', kind: 'unit', carry: 'share' }], run: PULL, mainlines: MAIN });

    expect(() => githubOutput(plan)).toThrow(/holds a space/);
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

  it('names what a commit-back stages by the paths `baselines.path` renders, never the whole root', () => {
    // Collocated, the root is the repository, and staging it would commit
    // whatever else the run left in the working tree. The old layout's
    // partitions are named too, so the pair `accept` retired goes out as a
    // deletion beside the file it moved to: a rename in the pull request.
    const collocated = carryPlan({
      direction: 'save',
      root,
      config: project({
        baselines: { kind: 'lfs', root: '/r', path: '{dir}/__baselines__/{file}/{name}-{engine}' },
      } as Partial<Config>),
      run: PULL,
      mainlines: MAIN,
    });

    expect(githubOutput(collocated).split('\n')).toEqual(expect.arrayContaining([
      'baselines-pathspecs<<VARIANCE_CARRY_END',
      ':(glob)/r/**/__baselines__/*/*-*.webp',
      ':(glob)/r/**/__baselines__/*/*-*.png',
      ':(glob)/r/**/__baselines__/*/*-*.json',
      `:(glob)/r/**/${PARTITION}/*`,
      ':(glob)/r/.gitattributes',
      'VARIANCE_CARRY_END',
    ]));

    const split = carryPlan({
      direction: 'save',
      root,
      config: project({
        baselines: { kind: 'directory', root: '/r/baselines', records: '/r/records' },
      } as Partial<Config>),
      run: PULL,
      mainlines: MAIN,
    });
    expect(split.baselinesPathspecs).toEqual([
      ':(glob)/r/baselines/**/*-*.webp',
      ':(glob)/r/baselines/**/*-*.png',
      ':(glob)/r/records/**/*-*.json',
      `:(glob)/r/baselines/**/${PARTITION}/*`,
      `:(glob)/r/records/**/${PARTITION}/*`,
    ]);
  });
});

describe('what a commit-back stages, as git reads it', () => {
  it('takes the WebP an accept keeps and the PNG kept before it, and nothing else beside them', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'variance-carry-stage-'));
    const files = ['src/__baselines__/a.tsx/A-chromium.webp', 'src/__baselines__/a.tsx/B-chromium.png', 'src/__baselines__/a.tsx/C-chromium.gif'];
    try {
      execFileSync('git', ['init', '--quiet', repo]);
      for (const file of files) {
        await mkdir(dirname(join(repo, file)), { recursive: true });
        await writeFile(join(repo, file), '');
      }
      const { baselinesPathspecs } = carryPlan({
        direction: 'save',
        root,
        config: project({ baselines: { kind: 'directory', root: repo, path: '{dir}/__baselines__/{file}/{name}-{engine}' } } as Partial<Config>),
        run: PULL,
        mainlines: MAIN,
      });
      const listed = execFileSync('git', ['-C', repo, 'ls-files', '--others', '--', ...baselinesPathspecs!], { encoding: 'utf8' });

      expect(listed.trim().split('\n').sort()).toEqual(['src/__baselines__/a.tsx/A-chromium.webp', 'src/__baselines__/a.tsx/B-chromium.png']);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('takes both spellings of an old partition, and no directory that only starts like one', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'variance-carry-stage-'));
    const hex = 'd9e2d62e05a69046dc75e1a987837b31';
    const files = [`ui/v1-${hex}/story.png`, `ui/v1:${hex}/story.json`, 'api/v1-beta/schema.json', 'api/v1-0/x.png'];
    try {
      execFileSync('git', ['init', '--quiet', repo]);
      for (const file of files) {
        await mkdir(dirname(join(repo, file)), { recursive: true });
        await writeFile(join(repo, file), '');
      }
      const { baselinesPathspecs } = carryPlan({
        direction: 'save',
        root,
        config: project({ baselines: { kind: 'directory', root: repo, path: '{dir}/__baselines__/{file}/{name}-{engine}' } } as Partial<Config>),
        run: PULL,
        mainlines: MAIN,
      });
      const listed = execFileSync('git', ['-C', repo, 'ls-files', '--others', '--', ...baselinesPathspecs!], { encoding: 'utf8' });

      expect(listed.trim().split('\n').sort()).toEqual([`ui/v1-${hex}/story.png`, `ui/v1:${hex}/story.json`]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
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
