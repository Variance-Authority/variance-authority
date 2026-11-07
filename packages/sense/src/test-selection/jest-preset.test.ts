import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SELECTION_RUNTIME, SELECTION_TRANSFORM, withJourneyCoverage, withTestSelection } from './jest.js';

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
  await writeFile(resolve(root, 'preset.cjs'), 'module.exports = { transform: { "\\\\.vue$": "vue-jest" } };\n');
  return root;
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

  it('wraps it for a preset named by path, and adds no pattern of its own beside it', async () => {
    const rootDir = await adopter();
    const configured = withTestSelection({ rootDir, preset: '<rootDir>/preset.cjs' }, { coverageFile: 'coverage.bin' });
    expect(Object.keys(configured.transform ?? {})).toEqual(['\\.vue$']);
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

  it('wraps a `transform` the object names, and Jest merges the preset\'s behind it', async () => {
    const rootDir = await adopter();
    const transform = { '^.+\\.tsx?$': ['ts-jest', {}] } as const;
    const configured = withTestSelection({ rootDir, preset: 'ts-jest', transform }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual({
      '^.+\\.tsx?$': [SELECTION_TRANSFORM, { root: rootDir, runtime: SELECTION_RUNTIME, transformer: ['ts-jest', {}] }],
    });
  });
});

describe('a Jest preset the wrap takes no `transform` from', () => {
  it.each(['plain-preset', 'emptied-preset'])('wraps Jest\'s default under %s, which has no transformer', async (preset) => {
    const rootDir = await adopter();
    const configured = withTestSelection({ rootDir, preset }, { coverageFile: 'coverage.bin' });
    expect(configured.transform).toEqual(wrapped(rootDir, 'babel-jest'));
    expect(configured['preset']).toBe(preset);
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
