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

/**
 * Both indexes transcribe what `packages/sense/test/fixtures/unentered-vitest`
 * actually recorded, asserted region by region in
 * `packages/sense/src/test-selection/vitest.integration.test.ts`. The one thing
 * added here is `distance`, which that recording does not hold.
 *
 * Neither module-root crossing carries `loaded`. A producer is not required to
 * mark one: a module root has no caller a test could be, so the reading is
 * derived from the region's own kind.
 */
const region = (
  kind: string,
  name: string,
  startLine: number,
  endLine: number,
  crossings: ExecutionIndex['modules'][number]['blocks'][number]['crossings'],
) => ({ kind, name, path: kind === 'module' ? 'module' : 'entry', startLine, endLine, source: true, crossings });

// `test/branch.dom.tsx`: <Panel points={[]} /> takes the EmptyState arm, so
// `HeavyChart` is imported, loaded, and never rendered.
const BRANCH: ExecutionIndex = {
  tests: [{ id: 'branch', file: 'test/branch.dom.tsx', name: 'shows the empty state when there are no points' }],
  modules: [
    { file: 'src/panel.tsx', blocks: [
      region('module', '', 5, 6, [{ test: 0, distance: 0 }]),
      region('function', 'Panel', 4, 6, [{ test: 0, distance: 1 }]),
    ] },
    { file: 'src/empty-state.tsx', blocks: [
      region('module', '', 2, 3, [{ test: 0, distance: 0 }]),
      region('function', 'EmptyState', 1, 3, [{ test: 0, distance: 2 }]),
    ] },
    { file: 'src/heavy-chart.tsx', blocks: [
      region('module', '', 7, 8, [{ test: 0, distance: 0 }]),
      region('function', 'HeavyChart', 5, 8, []),
      region('function', 'HeavyChart/reduce.arg0', 6, 6, []),
    ] },
  ],
};

// `test/spy.dom.tsx`: vi.spyOn(totals, 'formatTotal') answers in its place.
const SPY: ExecutionIndex = {
  tests: [{ id: 'spy', file: 'test/spy.dom.tsx', name: 'renders whatever the spy returns' }],
  modules: [
    { file: 'src/receipt.tsx', blocks: [
      region('module', '', 4, 5, [{ test: 0, distance: 0 }]),
      region('function', 'Receipt', 3, 5, [{ test: 0, distance: 1 }]),
    ] },
    { file: 'src/format-total.ts', blocks: [
      region('module', '', 3, 6, [{ test: 0, distance: 0 }]),
      region('function', 'formatTotal', 3, 6, []),
    ] },
  ],
};

describe('a named import nothing ever calls', () => {
  it('separates the module a branch only loaded from the modules the test entered', () => {
    const result = distill({ test: 'branch', execution: BRANCH });
    const modules = result.execution!.modules;

    // The file-level reading is unchanged, and is why this case needed its own:
    // by file, the test reached all three.
    expect(result.execution?.entered.map(({ file }) => file)).toEqual([
      'src/empty-state.tsx', 'src/heavy-chart.tsx', 'src/panel.tsx',
    ]);

    const chart = modules.find((module) => module.file === 'src/heavy-chart.tsx');
    expect(chart).toMatchObject({ loadedOnly: true, entered: [] });
    // The nested `reduce` callback is inside a function nobody called: one
    // fact, named once, at the declaration that owns it.
    expect(chart?.unentered.map(({ name }) => name)).toEqual(['HeavyChart']);

    expect(modules.filter((module) => module.loadedOnly).map(({ file }) => file))
      .toEqual(['src/heavy-chart.tsx']);
    expect(modules.find((module) => module.file === 'src/panel.tsx'))
      .toMatchObject({ loadedOnly: false, unentered: [] });
  });

  it('reads a spied-over import the same way, and proposes the substitution', () => {
    const result = distill({ test: 'spy', execution: SPY });
    expect(result.execution?.modules.find((module) => module.file === 'src/format-total.ts'))
      .toMatchObject({ loadedOnly: true, entered: [], unentered: [{ name: 'formatTotal' }] });

    const text = formatDistillation(result);
    expect(text).toContain('Loaded but not entered: 1 module(s).');
    expect(text).toContain('never entered: formatTotal (lines 3-6)');
    expect(text).toContain("substitution to try: vi.mock('src/format-total.ts')");
    // The proposal is a candidate, and the top level is what mocking also takes.
    expect(text).toContain('Mocking removes the top level too');
  });

  it('marks a region a producer says the module evaluated, not only the root', () => {
    // A top-level call enters a function without any test calling it. Only a
    // producer that watched the evaluation can say so, and one that can is
    // believed over the region's kind.
    const execution: ExecutionIndex = {
      tests: [{ id: 'eager', file: 'test/eager.case.ts', name: 'imports' }],
      modules: [{ file: 'src/eager.ts', blocks: [
        region('module', '', 1, 4, [{ test: 0, distance: 0 }]),
        region('function', 'warm', 1, 2, [{ test: 0, distance: 1, loaded: true }]),
        region('function', 'cold', 3, 4, []),
      ] }],
    };
    const eager = distill({ test: 'eager', execution }).execution?.modules[0];
    expect(eager).toMatchObject({ loadedOnly: true, entered: [] });
    expect(eager?.unentered.map(({ name }) => name)).toEqual(['cold']);
    expect(parseExecutionIndex(execution)).toEqual(execution);
    expect(() => parseExecutionIndex({ ...execution, modules: [{ file: 'x', blocks: [
      region('module', '', 1, 1, [{ test: 0, distance: 0, loaded: 'yes' } as never]),
    ] }] })).toThrow('loaded must be boolean');
  });
});
