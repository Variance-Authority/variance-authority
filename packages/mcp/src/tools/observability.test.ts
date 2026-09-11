import type { EyesArchive, TargetSnapshot } from '@variance-authority/eyes';
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import type { ObservabilitySubject } from '../observability-subject.js';
import { observabilityToolByName } from '../tools.js';
import { distillTool, observability } from './observability.js';

const TARGET: TargetSnapshot = {
  nodeName: 'button',
  role: 'button',
  ariaLabel: 'Redraw',
  provenance: {
    status: 'resolved',
    provenance: {
      owners: [{ name: 'DrawingPanel', propsDigest: 'props' }],
      source: { file: 'src/panel.tsx', line: 7, column: 3 },
    },
  },
};

const EYES: EyesArchive = {
  eyesVersion: 1,
  tests: [{
    id: 'redraw-test',
    title: 'redraws',
    complete: true,
    attention: [
      { kind: 'eyes-phase', phase: 'act', sequence: 0 },
      { kind: 'document-event', event: 'click', trusted: false, target: TARGET, sequence: 1 },
      {
        kind: 'react-commit',
        commit: {
          at: 8,
          components: ['DrawingPanel', 'Canvas'],
          updaters: [
            { path: [{ name: 'DrawingPanel', key: null, propsDigest: 'props' }] },
            { path: [{ name: 'Clock', key: null, propsDigest: 'clock-props' }] },
          ],
        },
        sequence: 2,
      },
    ],
  }],
};

const EXECUTION: ExecutionIndex = {
  tests: [{ id: 'redraw-test', file: 'test/redraw.test.tsx', name: 'redraws' }],
  modules: [
    {
      file: 'src/panel.tsx',
      blocks: [{
        kind: 'function', name: 'Panel', path: 'entry', startLine: 1, endLine: 20,
        source: true, crossings: [{ test: 0, distance: 2 }],
      }],
    },
    {
      file: 'src/top-nav.tsx',
      blocks: [{
        kind: 'function', name: 'TopNav', path: 'entry', startLine: 1, endLine: 20,
        source: true, crossings: [{ test: 0, distance: 5 }],
      }],
    },
  ],
};

describe('the composite observability surface', () => {
  it('distinguishes a missing domain from a measured empty one', () => {
    const text = observability.run({ eyes: EYES, presentations: [], scenarios: [] }, {});

    expect(text).toContain('available   — Eyes attention: 1 test journal(s)');
    expect(text).toContain('available   — presentation readings: 0 full graph(s)');
    expect(text).toContain('available   — scenario AAA: 0 retained execution(s)');
    expect(text).toContain('unavailable — runtime journey');
    expect(text).toContain('runtime journey — supply an ExecutionIndex from a producer holding stable per-test crossings');
    expect(text).not.toContain('scenario AAA — record host-produced snapshots');
  });

  it('routes every missing domain to its producer without guiding supplied evidence', () => {
    const text = observability.run({}, {});

    expect(text).toContain('To supply missing evidence:');
    expect(text).toContain('visual/report — run `variance run`');
    expect(text).toContain('presentation readings — acquire PresentationReport values');
    expect(text).toContain('live journey/events — start the watcher first');
    expect(text).toContain('Eyes attention — compose the Eyes adapter');
    expect(text).toContain('scenario AAA — record host-produced snapshots');

    const supplied = observability.run({
      presentations: [],
      execution: { tests: [], modules: [] },
      eyes: { eyesVersion: 1, tests: [] },
      scenarios: [],
    }, {});
    expect(supplied).not.toContain('presentation readings — acquire PresentationReport values');
    expect(supplied).not.toContain('runtime journey — supply an ExecutionIndex');
    expect(supplied).not.toContain('Eyes attention — compose the Eyes adapter');
    expect(supplied).not.toContain('scenario AAA — record host-produced snapshots');
  });

  it('lifts native tools and refuses to manufacture an empty missing subject', () => {
    expect(observabilityToolByName('variance_test_attention')!.run({ eyes: EYES }, {}))
      .toContain('1 Eyes test(s)');
    expect(() => observabilityToolByName('variance_source_tests')!.run({}, { file: 'src/panel.tsx' }))
      .toThrow('runtime journey evidence is unavailable');
  });

  it('joins Eyes and Sense only by exact test id and calls reduction targets candidates', () => {
    const subject: ObservabilitySubject = { eyes: EYES, execution: EXECUTION };
    const text = distillTool.run(subject, { test: 'redraw-test' });

    expect(text).toContain('act:\n  components: DrawingPanel\n  source: src/panel.tsx');
    expect(text).toContain('inside addressed component paths: DrawingPanel');
    expect(text).toContain('outside addressed component paths: Clock');
    expect(text).toContain('ExecutionIndex retains test crossings, not AAA intervals');
    expect(text).toContain('distillation opportunity at depth 5 — src/top-nav.tsx');
    expect(text).toContain('does not establish that it is safe to mock');
  });

  it('refuses title and file guesses when the exact runtime identity is absent', () => {
    const mismatched: ExecutionIndex = {
      ...EXECUTION,
      tests: [{ ...EXECUTION.tests[0]!, id: 'another-id' }],
    };
    const text = distillTool.run({ eyes: EYES, execution: mismatched }, { test: 'redraw-test' });

    expect(text).toContain('contains no test with exact id redraw-test');
    expect(text).toContain('No title or file join was guessed.');
  });
});
