import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTransformer } from './jest-transform.js';
import { SELECTION_RUNTIME, SELECTION_TRANSFORM, withJourneyCoverage, withTestSelection, type SelectionTransformerConfig } from './jest.js';

const INSTALLED_JEST = resolve(import.meta.dirname, '../../../../node_modules/jest');
const temporary: string[] = [];

afterEach(async () => {
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
  return root;
}

/** A checkout with Jest at its root, and a project below it holding the only copy of a transformer. */
async function nestedProject(): Promise<string> {
  const checkout = await adopter();
  execFileSync('git', ['init', '--quiet'], { cwd: checkout });
  const rootDir = resolve(checkout, 'packages/app');
  await mkdir(resolve(rootDir, 'node_modules/vue-jest'), { recursive: true });
  await writeFile(resolve(rootDir, 'package.json'), '{"name":"app","private":true}\n');
  await writeFile(resolve(rootDir, 'node_modules/vue-jest/index.js'), 'module.exports = { process: (text) => ({ code: text }) };\n');
  return rootDir;
}

const wrapped = (root: string, transformer?: string): unknown => ({
  '\\.[jt]sx?$': [SELECTION_TRANSFORM, { root, runtime: SELECTION_RUNTIME, ...(transformer === undefined ? {} : { transformer }) }],
});

const TS_PATTERNS = ['^.+\\.tsx?$'];

const wrappedPreset = (root: string): unknown => ({
  '^.+\\.tsx?$': [SELECTION_TRANSFORM, { root, runtime: SELECTION_RUNTIME, transformer: ['ts-jest', {}] }],
});

describe('a Jest preset that has a `transform`', () => {
  it('wraps the preset\'s transformer, as Jest would have run it', async () => {
    const rootDir = await adopter();
    const configured = withTestSelection({ rootDir, preset: 'ts-jest' }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual(wrappedPreset(rootDir));
  });

  it('wraps it for one project of several, found from that project\'s `rootDir`', async () => {
    const rootDir = await adopter();
    const configured = withTestSelection(
      { rootDir: resolve(rootDir, 'node_modules'), projects: [{ displayName: 'plain' }, { rootDir, preset: 'ts-jest' }] },
      { coverageFile: 'coverage.bin' },
    );
    const [, project] = configured['projects'] as { transform: object }[];
    expect(Object.keys(project!.transform)).toEqual(TS_PATTERNS);
  });

  it('wraps it under a journey wrap, which wraps the same transforms', async () => {
    const rootDir = await adopter();
    const configured = withJourneyCoverage({ rootDir, preset: 'ts-jest' }, { journeyFile: 'journeys.bin' });
    expect(Object.keys(configured.transform ?? {})).toEqual(TS_PATTERNS);
  });

  it('reads the preset from the object\'s `rootDir`, where Jest reads it, under a `root` of the wrap\'s', async () => {
    const rootDir = await adopter();
    const root = resolve(rootDir, '..');
    const selected = withTestSelection({ rootDir, preset: 'ts-jest' }, { root, coverageFile: 'coverage.bin' });
    const journeyed = withJourneyCoverage({ rootDir, preset: 'ts-jest' }, { root, journeyFile: 'journeys.bin' });
    expect(Object.keys(selected.transform ?? {})).toEqual(TS_PATTERNS);
    expect(Object.keys(journeyed.transform ?? {})).toEqual(TS_PATTERNS);
  });

  it('wraps a `transform` the object names, and Jest merges the preset\'s behind it', async () => {
    const rootDir = await adopter();
    const transform = { '^.+\\.tsx?$': ['ts-jest', {}] } as const;
    const configured = withTestSelection({ rootDir, preset: 'ts-jest', transform }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual({
      '^.+\\.tsx?$': [SELECTION_TRANSFORM, { root: rootDir, runtime: SELECTION_RUNTIME, transformer: ['ts-jest', {}] }],
    });
  });

  it('wraps only a partial `transform`, and Jest merges the preset\'s behind it', async () => {
    const rootDir = await adopter();
    const transform = { '\\.css$': 'css-transformer' };
    const configured = withTestSelection({ rootDir, preset: 'ts-jest', transform }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual({
      '\\.css$': [SELECTION_TRANSFORM, { root: rootDir, runtime: SELECTION_RUNTIME, transformer: 'css-transformer' }],
    });
  });

  it('instruments directly when the object sets `transform: {}`, as it does with no preset', async () => {
    const rootDir = await adopter();
    const configured = withTestSelection({ rootDir, preset: 'ts-jest', transform: {} }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual(wrapped(rootDir));
  });
});

describe('a transformer the project at `rootDir` holds, under a checkout root above it', () => {
  it('loads it from the project, where Jest finds it', async () => {
    const rootDir = await nestedProject();
    await writeFile(resolve(rootDir, 'preset.cjs'), 'module.exports = { transform: { "\\\\.vue$": "vue-jest" } };\n');
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

  it('leaves the preset to Jest in a project that cannot find Jest', () => {
    const configured = withTestSelection({ rootDir: '/repo', preset: 'ts-jest' }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual(wrapped('/repo', 'babel-jest'));
  });
});
