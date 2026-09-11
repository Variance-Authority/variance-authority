import type { EyesArchive, TargetSnapshot } from '@variance-authority/eyes';
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { distill, formatDistillation, parseExecutionIndex } from './index.js';

const TARGET: TargetSnapshot = {
  nodeName: 'button', role: 'button', ariaLabel: 'Redraw',
  provenance: { status: 'resolved', provenance: {
    owners: [{ name: 'DrawingPanel', propsDigest: 'props' }],
    source: { file: 'src/panel.tsx', line: 7, column: 3 },
  } },
};

const EYES: EyesArchive = { eyesVersion: 1, tests: [{
  id: 'redraw-test', title: 'redraws', complete: true,
  attention: [
    { kind: 'eyes-phase', phase: 'act', sequence: 0 },
    { kind: 'document-event', event: 'click', trusted: false, target: TARGET, sequence: 1 },
    { kind: 'react-commit', commit: { at: 8, components: ['DrawingPanel'], updaters: [
      { path: [{ name: 'DrawingPanel', key: null, propsDigest: 'props' }] },
      { path: [{ name: 'Clock', key: null, propsDigest: 'clock-props' }] },
    ] }, sequence: 2 },
  ],
}] };

const EXECUTION: ExecutionIndex = { tests: [
  { id: 'redraw-test', file: 'test/redraw.test.tsx', name: 'redraws' },
], modules: [
  { file: 'src/panel.tsx', blocks: [{ kind: 'function', name: 'Panel', path: 'entry',
    startLine: 1, endLine: 20, source: true, crossings: [{ test: 0, distance: 2 }] }] },
  { file: 'src/top-nav.tsx', blocks: [{ kind: 'function', name: 'TopNav', path: 'entry',
    startLine: 1, endLine: 20, source: true, crossings: [{ test: 0, distance: 5 }] }] },
] };

describe('distill', () => {
  it('separates addressed source, outside update initiators, and opportunities', () => {
    const result = distill({ test: 'redraw-test', eyes: EYES, execution: EXECUTION });
    expect(result.attention?.phases[0]).toEqual({
      phase: 'act', components: ['DrawingPanel'], files: ['src/panel.tsx'],
    });
    expect(result.attention?.updates[0]).toMatchObject({ inside: ['DrawingPanel'], outside: ['Clock'] });
    expect(result.execution?.opportunities).toEqual([{ file: 'src/top-nav.tsx', distance: 5 }]);
    expect(formatDistillation(result)).toContain('distillation opportunity at depth 5 — src/top-nav.tsx');
  });

  it('keeps a non-React test useful and calls its addressed surface measured empty', () => {
    const eyes: EyesArchive = { eyesVersion: 1, tests: [{
      id: 'plain', title: 'parses', complete: true, attention: [],
    }] };
    const execution: ExecutionIndex = { tests: [{ id: 'plain', file: 'parse.test.ts', name: 'parses' }],
      modules: [{ file: 'parse.ts', blocks: [{ kind: 'function', name: 'parse', path: 'entry',
        startLine: 1, endLine: 2, source: true, crossings: [{ test: 0, distance: 1 }] }] }] };
    const text = formatDistillation(distill({ test: 'plain', eyes, execution }));
    expect(text).toContain('Addressed surface: measured empty.');
    expect(text).toContain('distillation opportunity at depth 1 — parse.ts');
  });

  it('does not turn missing attention into an empty addressed surface', () => {
    const result = distill({ test: 'redraw-test', execution: EXECUTION });
    expect(result.execution?.entered).toHaveLength(2);
    expect(result.execution?.opportunities).toBeUndefined();
    expect(formatDistillation(result)).toContain(
      'Distillation opportunities: unavailable; Eyes attention was not supplied.',
    );
  });

  it('validates execution indexes at the JSON boundary', () => {
    expect(parseExecutionIndex(EXECUTION)).toEqual(EXECUTION);
    expect(() => parseExecutionIndex({ tests: [], modules: [{ file: 'x', blocks: [{}] }] }))
      .toThrow('crossings must be an array');
  });
});
