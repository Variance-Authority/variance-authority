import type { ScenarioArchiveManifest } from '@variance-authority/scenario/archive';
import { describe, expect, it } from 'vitest';
import { scenarios } from './scenarios.js';

const MANIFEST: ScenarioArchiveManifest = {
  archiveVersion: 1,
  address: {
    project: 'drawing',
    run: 'run-1',
    scenario: 'redraw',
    execution: 'redraw-chromium',
    precondition: 'blank-canvas',
    profile: 'chromium',
    attempt: '1',
  },
  retainUntil: '2030-01-01T00:00:00.000Z',
  access: 'project members',
  deletion: 'expiry collector',
  definition: {
    scenarioVersion: 1,
    id: 'redraw',
    acts: [{ key: 'click-redraw' }, { key: 'wait-for-paint' }],
  },
  execution: {
    executionVersion: 1,
    id: 'redraw-chromium',
    definition: 'redraw',
    precondition: { id: 'blank-canvas', kind: 'story' },
    preconditionLink: { kind: 'resolved', parent: 'drawing', how: 'declared' },
    profile: 'chromium',
    frames: [
      { at: 0, outcome: { kind: 'observed', snapshot: 'arrange', state: 'blank' } },
      {
        at: 1,
        act: { key: 'click-redraw', occurrence: 1 },
        outcome: { kind: 'observed', snapshot: 'acted', state: 'painting' },
      },
      {
        at: 2,
        act: { key: 'wait-for-paint', occurrence: 1 },
        outcome: {
          kind: 'unobserved',
          diagnostics: [{ severity: 'warn', code: 'timeout', message: 'paint did not settle' }],
        },
      },
    ],
  },
  snapshots: ['arrange', 'acted'],
};

describe('variance_scenarios', () => {
  it('lists retained executions and their Arrange/Act shape', () => {
    expect(scenarios.run([MANIFEST], {})).toContain(
      'redraw / redraw-chromium — Arrange blank-canvas, 2 Act frame(s)',
    );
  });

  it('keeps observed and unobserved outcomes distinct', () => {
    const text = scenarios.run([MANIFEST], { scenario: 'redraw' });

    expect(text).toContain('Arrange blank-canvas → observed state blank');
    expect(text).toContain('Act click-redraw #1 → observed state painting');
    expect(text).toContain('Act wait-for-paint #1 → unobserved: paint did not settle');
  });
});
