import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SELECTION_GLOBALS,
  SELECTION_REPORTER,
  SELECTION_RUNTIME,
  SELECTION_SETUP,
  SELECTION_TRANSFORM,
  withJourneyCoverage,
} from './jest.js';

describe('withJourneyCoverage for Jest', () => {
  it('records journeys without configuring a test-selection snapshot', () => {
    const configured = withJourneyCoverage(
      { rootDir: '/repo', transform: { '\\.tsx?$': '@swc/jest' } },
      { journeyFile: 'artifacts/shard-3.journeys.bin', preconditions: ['test/environment.ts'] },
    );

    expect(configured.transform).toEqual({
      '\\.tsx?$': [SELECTION_TRANSFORM, {
        root: '/repo',
        runtime: SELECTION_RUNTIME,
        transformer: '@swc/jest',
        exclude: ['/repo/test/environment.ts'],
        cadence: false,
      }],
    });
    expect(configured.setupFiles).toEqual([SELECTION_GLOBALS]);
    expect(configured.setupFilesAfterEnv).toEqual([SELECTION_SETUP]);
    expect(configured.reporters).toEqual([
      'default',
      [SELECTION_REPORTER, { root: '/repo', journeyFile: '/repo/artifacts/shard-3.journeys.bin' }],
    ]);
  });

  it('constructs every runtime through ours, which requires the trace once per worker', () => {
    const rootDir = resolve(import.meta.dirname, '../..');
    const configured = withJourneyCoverage(
      { rootDir, testEnvironment: 'jsdom', testEnvironmentOptions: { customExportConditions: ['node'] } },
      { journeyFile: 'journeys.bin', trace: '<rootDir>/test/sentry.cjs' },
    );

    // The environment is Jest's to choose per file; only the runtime is ours.
    expect(configured.testEnvironment).toBe('jsdom');
    expect(configured['runtime']).toBe(SELECTION_RUNTIME);
    expect(configured.testEnvironmentOptions).toEqual({ customExportConditions: ['node'] });
    expect(configured.globals).toEqual({
      'variance-authority.runtime': { root: expect.any(String), trace: resolve(rootDir, 'test/sentry.cjs') },
    });
    expect(() => withJourneyCoverage({ rootDir }, { journeyFile: 'journeys.bin', trace: '@sentry/node' }))
      .toThrow(/is not a path/);
  });

  it("constructs the project's own runtime, resolved as Jest resolves it", () => {
    const rootDir = resolve(import.meta.dirname, '../..');
    const configured = withJourneyCoverage(
      { rootDir, runtime: '<rootDir>/test/runtime.cjs' },
      { journeyFile: 'journeys.bin' },
    );

    expect(configured['runtime']).toBe(SELECTION_RUNTIME);
    expect(configured.globals).toEqual({
      'variance-authority.runtime': { root: expect.any(String), runtime: resolve(rootDir, 'test/runtime.cjs') },
    });
  });

  it("keeps the project's runtime through a second wrap, never naming its own", () => {
    const rootDir = resolve(import.meta.dirname, '../..');
    const once = withJourneyCoverage({ rootDir, runtime: '<rootDir>/test/runtime.cjs' }, { journeyFile: 'journeys.bin' });
    const twice = withJourneyCoverage(once, { journeyFile: 'journeys.bin' });

    expect(twice['runtime']).toBe(SELECTION_RUNTIME);
    expect(twice.globals).toEqual(once.globals);
  });

  it("leaves a preset's environment options to the preset", () => {
    // Jest merges `globals` with a preset, and spreads every other key over it.
    const configured = withJourneyCoverage({ rootDir: '/repo', preset: 'ts-jest' }, { journeyFile: 'journeys.bin' });

    expect(configured).not.toHaveProperty('testEnvironmentOptions');
  });

  it.todo('marks the modules `unprobed` names as loaded, as withTestSelection does — needs `unprobed` on JestJourneyCoverageOptions');
});
