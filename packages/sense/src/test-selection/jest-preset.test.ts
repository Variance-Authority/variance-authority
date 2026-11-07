import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTransformer } from './jest-transform.js';
import { SELECTION_RUNTIME, SELECTION_TRANSFORM, withJourneyCoverage, withTestSelection, type SelectionTransformerConfig } from './jest.js';

const INSTALLED_JEST = resolve(import.meta.dirname, '../../../../node_modules/jest');
const temporary: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/** A project with Jest installed and packages that are presets, as `ts-jest` is one. */
async function adopter(): Promise<string> {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-jest-preset-')));
  temporary.push(root);
  await writeFile(resolve(root, 'package.json'), '{"name":"fixture","private":true}\n');
  await mkdir(resolve(root, 'node_modules'));
  await symlink(INSTALLED_JEST, resolve(root, 'node_modules/jest'));
  const presets = {
    'ts-jest/jest-preset.js': 'module.exports = { transform: { "^.+\\\\.tsx?$": ["ts-jest", {}] } };\n',
    'plain-preset/jest-preset.json': '{ "testEnvironment": "node" }\n',
    'emptied-preset/jest-preset.json': '{ "transform": {} }\n',
    'broken-preset/jest-preset.js': 'throw new Error("this preset does not load");\n',
  };
  for (const [file, text] of Object.entries(presets)) {
    await mkdir(resolve(root, 'node_modules', file, '..'), { recursive: true });
    await writeFile(resolve(root, 'node_modules', file), text);
  }
  await writeFile(resolve(root, 'async-preset.mjs'), 'await 0;\nexport default { transform: { "\\\\.vue$": "vue-jest" } };\n');
  await writeFile(resolve(root, 'preset.cjs'), 'module.exports = { transform: { "\\\\.vue$": "vue-jest" } };\n');
  return root;
}

/** A checkout with Jest at its root, and a project below it holding the only copy of a transformer. */
async function nestedProject(): Promise<string> {
  const checkout = await adopter();
  execFileSync('git', ['init', '--quiet'], { cwd: checkout });
  const rootDir = resolve(checkout, 'packages/app');
  await mkdir(resolve(rootDir, 'node_modules/vue-jest'), { recursive: true });
  const transformer = 'module.exports = { process: (text) => ({ code: text }) };\n';
  await writeFile(resolve(rootDir, 'package.json'), '{"name":"app","private":true}\n');
  await writeFile(resolve(rootDir, 'node_modules/vue-jest/index.js'), transformer);
  await writeFile(resolve(rootDir, 'vue.cjs'), transformer);
  return rootDir;
}

const wrapped = (root: string, transformer?: string): unknown => ({
  '\\.[jt]sx?$': [SELECTION_TRANSFORM, { root, runtime: SELECTION_RUNTIME, ...(transformer === undefined ? {} : { transformer }) }],
});

const TS_JEST = { '^.+\\.tsx?$': ['ts-jest', {}] } as const;

const wrappedPreset = (root: string): unknown => ({
  '^.+\\.tsx?$': [SELECTION_TRANSFORM, { root, runtime: SELECTION_RUNTIME, transformer: ['ts-jest', {}] }],
});

describe('a Jest preset that has a `transform`', () => {
  it('wraps the preset\'s transformer, as Jest would have run it', async () => {
    const rootDir = await adopter();
    const configured = withTestSelection({ rootDir, preset: 'ts-jest' }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual(wrappedPreset(rootDir));
  });

  it('adds no pattern of its own beside a pattern that takes scripts', async () => {
    const rootDir = await adopter();
    const configured = withTestSelection({ rootDir, preset: 'ts-jest' }, { coverageFile: 'coverage.bin' });
    expect(Object.keys(configured.transform ?? {})).toEqual(Object.keys(TS_JEST));
  });

  it('instruments scripts directly after a preset whose patterns take none, which Jest leaves as they are', async () => {
    const rootDir = await adopter();
    const configured = withTestSelection({ rootDir, preset: '<rootDir>/preset.cjs' }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual({
      '\\.vue$': [SELECTION_TRANSFORM, { root: rootDir, runtime: SELECTION_RUNTIME, transformer: 'vue-jest' }],
      ...wrapped(rootDir) as object,
    });
    expect(Object.keys(configured.transform ?? {})).toEqual(['\\.vue$', '\\.[jt]sx?$']);
  });

  it('wraps it when the object sets `transform: {}`, which Jest fills from the preset', async () => {
    const rootDir = await adopter();
    const configured = withTestSelection({ rootDir, preset: 'ts-jest', transform: {} }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual(wrappedPreset(rootDir));
  });

  it('wraps it for one project of several, found from that project\'s `rootDir`', async () => {
    const rootDir = await adopter();
    const configured = withTestSelection(
      { rootDir: resolve(rootDir, 'node_modules'), projects: [{ displayName: 'plain' }, { rootDir, preset: 'ts-jest' }] },
      { coverageFile: 'coverage.bin' },
    );
    const [, project] = configured['projects'] as { transform: object }[];
    expect(Object.keys(project!.transform)).toEqual(Object.keys(TS_JEST));
  });

  it('wraps it under a journey wrap, which wraps the same transforms', async () => {
    const rootDir = await adopter();
    const configured = withJourneyCoverage({ rootDir, preset: 'ts-jest' }, { journeyFile: 'journeys.bin' });
    expect(Object.keys(configured.transform ?? {})).toEqual(Object.keys(TS_JEST));
  });

  it('reads the preset from the object\'s `rootDir`, where Jest reads it, under a `root` of the wrap\'s', async () => {
    const rootDir = await adopter();
    const root = resolve(rootDir, '..');
    const selected = withTestSelection({ rootDir, preset: 'ts-jest' }, { root, coverageFile: 'coverage.bin' });
    const journeyed = withJourneyCoverage({ rootDir, preset: 'ts-jest' }, { root, journeyFile: 'journeys.bin' });
    expect(Object.keys(selected.transform ?? {})).toEqual(Object.keys(TS_JEST));
    expect(Object.keys(journeyed.transform ?? {})).toEqual(Object.keys(TS_JEST));
  });

  it('wraps a `transform` the object names, and Jest merges the preset\'s behind it', async () => {
    const rootDir = await adopter();
    const transform = { '^.+\\.tsx?$': ['ts-jest', {}] } as const;
    const configured = withTestSelection({ rootDir, preset: 'ts-jest', transform }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual({
      '^.+\\.tsx?$': [SELECTION_TRANSFORM, { root: rootDir, runtime: SELECTION_RUNTIME, transformer: ['ts-jest', {}] }],
    });
  });

  it('wraps the preset\'s patterns beside a partial `transform`, in the order Jest merges them', async () => {
    const rootDir = await adopter();
    const transform = { '\\.css$': '<rootDir>/css.cjs' };
    const configured = withTestSelection({ rootDir, preset: 'ts-jest', transform }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual({
      '\\.css$': [SELECTION_TRANSFORM, { root: rootDir, runtime: SELECTION_RUNTIME, transformer: '<rootDir>/css.cjs' }],
      ...wrappedPreset(rootDir) as object,
    });
    expect(Object.keys(configured.transform ?? {})).toEqual(['\\.css$', '^.+\\.tsx?$']);
  });
});

describe('a transformer the project at `rootDir` holds, under a checkout root above it', () => {
  it.each(['vue-jest', '<rootDir>/vue.cjs'])('loads %s from the project, where Jest finds it', async (name) => {
    const rootDir = await nestedProject();
    await writeFile(resolve(rootDir, 'preset.cjs'), `module.exports = { transform: { "\\\\.vue$": ${JSON.stringify(name)} } };\n`);
    const configured = withTestSelection({ rootDir, preset: '<rootDir>/preset.cjs' }, { coverageFile: 'coverage.bin' });
    const [, { runtime: _, ...options }] = configured.transform!['\\.vue$'] as [string, SelectionTransformerConfig];
    expect(options.root).toBe(resolve(rootDir, '../..'));
    await expect(createTransformer(options)).resolves.toHaveProperty('process');
  });
});

describe('a Jest preset the wrap takes no `transform` from', () => {
  it('wraps Jest\'s default under a preset that says nothing of `transform`', async () => {
    const rootDir = await adopter();
    const configured = withTestSelection({ rootDir, preset: 'plain-preset' }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual(wrapped(rootDir, 'babel-jest'));
    expect(configured['preset']).toBe('plain-preset');
  });

  it('instruments directly under a preset that says `transform: {}`, which is Jest running plain JavaScript', async () => {
    const rootDir = await adopter();
    const configured = withTestSelection({ rootDir, preset: 'emptied-preset' }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual(wrapped(rootDir));
  });

  it.each(['missing-preset', 'broken-preset'])('leaves %s to Jest, which says what is wrong with it', async (preset) => {
    const rootDir = await adopter();
    const configured = withTestSelection({ rootDir, preset }, { coverageFile: 'coverage.bin' });
    expect(configured['preset']).toBe(preset);
  });

  it('says which preset it cannot read, one Jest imports for its top-level await, and what to spell out', async () => {
    const rootDir = await adopter();
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const configured = withTestSelection({ rootDir, preset: '<rootDir>/async-preset.mjs' }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual(wrapped(rootDir, 'babel-jest'));
    expect(write.mock.calls).toEqual([[expect.stringMatching(/^variance-authority: .*<rootDir>\/async-preset\.mjs.*`transform`.*\n$/u)]]);
  });

  it('says nothing of a preset it cannot read to an object that spells out `transform`', async () => {
    const rootDir = await adopter();
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    withTestSelection({ rootDir, preset: '<rootDir>/async-preset.mjs', transform: TS_JEST }, { coverageFile: 'coverage.bin' });
    expect(write).not.toHaveBeenCalled();
  });

  it('leaves the preset to Jest in a project that cannot find Jest', () => {
    const configured = withTestSelection({ rootDir: '/repo', preset: 'ts-jest' }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual(wrapped('/repo', 'babel-jest'));
  });
});
