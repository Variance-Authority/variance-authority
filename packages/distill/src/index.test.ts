import type { TargetSnapshot } from '@variance-authority/eyes';
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { distill, formatDistillation, parseExecutionIndex, type EyesAttempt } from './index.js';

const TARGET: TargetSnapshot = {
  nodeName: 'button', role: 'button', ariaLabel: 'Redraw',
  provenance: { status: 'resolved', provenance: {
    owners: [{ name: 'DrawingPanel', propsDigest: 'props' }],
    source: { file: 'src/panel.tsx', line: 7, column: 3 },
  } },
};

const EYES: readonly EyesAttempt[] = [{
  case: 'redraw-test', attempt: 1, journal: { complete: true,
  attention: [
    { kind: 'eyes-phase', phase: 'act', sequence: 0 },
    { kind: 'document-event', event: 'click', trusted: false, target: TARGET, sequence: 1 },
    { kind: 'react-commit', commit: { at: 8, components: ['DrawingPanel'], updaters: [
      { path: [{ name: 'DrawingPanel', key: null, propsDigest: 'props' }] },
      { path: [{ name: 'Clock', key: null, propsDigest: 'clock-props' }] },
    ] }, sequence: 2 },
  ] },
}];

const EXECUTION: ExecutionIndex = { tests: [
  { id: 'redraw-test', file: 'test/redraw.test.tsx', name: 'redraws' },
], modules: [
  { file: 'src/panel.tsx', blocks: [{ kind: 'function', name: 'Panel', path: 'entry',
    startLine: 1, endLine: 20, source: true, crossings: [{ test: 0, distance: 2 }] }] },
  { file: 'src/top-nav.tsx', blocks: [{ kind: 'function', name: 'TopNav', path: 'entry',
    startLine: 1, endLine: 20, source: true, crossings: [{ test: 0, distance: 5 }] }] },
] };

/** The same test, with its addressed component named by the given source files. */
const addressedAt = (...files: readonly string[]): readonly EyesAttempt[] => [{
  case: 'redraw-test', attempt: 1, journal: {
    complete: true,
    attention: files.map((file, at) => ({
      kind: 'document-event', event: 'click', trusted: false, sequence: at,
      target: { ...TARGET, provenance: { status: 'resolved', provenance: {
        owners: [{ name: 'DrawingPanel', propsDigest: 'props' }],
        source: { file, line: 7, column: 3 },
      } } },
    })),
  },
}];

describe('distill', () => {
  it('separates addressed source, outside update initiators, and opportunities', () => {
    const result = distill({ test: 'redraw-test', eyes: EYES, execution: EXECUTION });
    expect(result.attempts?.[0]?.phases[0]).toEqual({
      phase: 'act', components: ['DrawingPanel'], files: ['src/panel.tsx'],
    });
    expect(result.attempts?.[0]?.updates[0]).toMatchObject({ inside: ['DrawingPanel'], outside: ['Clock'] });
    expect(result.execution?.opportunities).toEqual([{ file: 'src/top-nav.tsx', distance: 5 }]);
    expect(formatDistillation(result)).toContain('distillation opportunity at depth 5 — src/top-nav.tsx');
  });

  it('keeps a non-React test useful and calls its addressed surface measured empty', () => {
    const eyes: readonly EyesAttempt[] = [{ case: 'plain', attempt: 1, journal: { complete: true, attention: [] } }];
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
      'Distillation opportunities: unavailable; the record keeps no Eyes journals; the run did not opt into Eyes.',
    );
  });

  it('tells a record without Eyes from a case the record kept no journal for', () => {
    const elsewhere = [{ ...EYES[0]!, case: 'another-case' }];
    const result = distill({ test: 'redraw-test', eyes: elsewhere, execution: EXECUTION });
    expect(result.attempts).toEqual([]);
    expect(result.execution.withheld).toBe('the record keeps no Eyes journal for this case.');
    expect(formatDistillation(result))
      .toContain('Eyes attention: unavailable; the record keeps no Eyes journal for this case.');
  });

  it('tells a case whose run did not watch it from a watched case that handed no journal', () => {
    const elsewhere = [{ ...EYES[0]!, case: 'another-case' }];
    const unwatched = distill({ test: 'redraw-test', eyes: elsewhere, watched: ['another-case'], execution: EXECUTION });
    expect(unwatched.execution.withheld).toBe('this case\'s run did not opt into Eyes.');
    expect(formatDistillation(unwatched))
      .toContain('Eyes attention: unavailable; this case\'s run did not opt into Eyes.');
    expect(formatDistillation(unwatched)).not.toContain('keeps no Eyes journal for this case');
    const watched = distill({
      test: 'redraw-test', eyes: elsewhere, watched: ['another-case', 'redraw-test'], execution: EXECUTION,
    });
    expect(watched.execution.withheld).toBe('the record keeps no Eyes journal for this case.');
  });

  it('reads a retried case attempt by attempt, and counts what any attempt addressed', () => {
    // Attempt 1 addressed the panel; the retry addressed the navigation too.
    const navigation: TargetSnapshot = { ...TARGET, provenance: { status: 'resolved', provenance: {
      owners: [{ name: 'TopNav', propsDigest: 'nav' }],
      source: { file: 'src/top-nav.tsx', line: 3, column: 1 },
    } } };
    const retried: readonly EyesAttempt[] = [
      { case: 'redraw-test', attempt: 2, journal: { complete: true, attention: [
        { kind: 'document-event', event: 'click', trusted: false, target: navigation, sequence: 0 },
      ] } },
      EYES[0]!,
    ];
    const result = distill({ test: 'redraw-test', eyes: retried, execution: EXECUTION });

    expect(result.attempts?.map((attempt) => attempt.attempt)).toEqual([1, 2]);
    expect(result.attempts?.[1]?.phases).toEqual([
      { phase: 'unphased', components: ['TopNav'], files: ['src/top-nav.tsx'] },
    ]);
    // Neither file is an opportunity: some attempt addressed each of them.
    expect(result.execution.opportunities).toEqual([]);

    const text = formatDistillation(result);
    expect(text).toContain('Eyes journal, attempt 1: complete.');
    expect(text).toContain('Eyes journal, attempt 2: complete.');
  });

  it('refuses an id the record does not hold, showing the ids it does', () => {
    const execution: ExecutionIndex = {
      tests: Array.from({ length: 8 }, (_unused, at) => ({
        id: `test/redraw.test.tsx > case ${at}`,
        file: 'test/redraw.test.tsx',
        name: `case ${at}`,
      })),
      modules: [],
    };
    // Playwright's opaque test id, the spelling a record never uses.
    const refusal = (() => {
      try {
        distill({ test: '875862714_0', execution });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(refusal).toContain('The record holds no case with id 875862714_0.');
    expect(refusal).toContain('It records 8 case id(s), of which:');
    expect(refusal).toContain('  test/redraw.test.tsx > case 0');
    expect(refusal).toContain('  and 3 more.');
    expect(refusal).not.toContain('case 5');
  });

  it('says the record holds no cases rather than listing an empty sample', () => {
    expect(() => distill({ test: 'plain', execution: { tests: [], modules: [] } }))
      .toThrow('it records no cases at all');
  });

  it('refuses a title where an id belongs', () => {
    expect(() => distill({ test: 'redraws', eyes: EYES, execution: EXECUTION }))
      .toThrow('The record holds no case with id redraws.');
  });

  it('joins an absolute addressed path to a project-relative entered module', () => {
    // What a normal run supplies: Eyes names the component's source the way the
    // bundler handed it over, and Sense names the module through `projectPath`.
    const eyes = addressedAt('/repo/src/panel.tsx');
    const result = distill({ test: 'redraw-test', eyes, execution: EXECUTION, root: '/repo' });
    expect(result.execution?.opportunities).toEqual([{ file: 'src/top-nav.tsx', distance: 5 }]);
    // The addressed component is the file this defect used to name first.
    expect(result.execution?.opportunities?.map(({ file }) => file)).not.toContain('src/panel.tsx');
    expect(result.execution?.addressedNotEntered).toBeUndefined();
  });

  it('withholds the comparison when the two sides disagree and no root was supplied', () => {
    const result = distill({ test: 'redraw-test', eyes: addressedAt('/repo/src/panel.tsx'), execution: EXECUTION });
    expect(result.execution?.opportunities).toBeUndefined();
    expect(result.execution?.withheld).toContain('no root was supplied');
    const text = formatDistillation(result);
    expect(text).toContain('Distillation opportunities: unavailable;');
    // The failure being fixed is a confident list, so no list may be printed.
    expect(text).not.toContain('distillation opportunity at depth');
  });

  it('withholds the comparison when the supplied root joins nothing', () => {
    const result = distill({
      test: 'redraw-test', eyes: addressedAt('/repo/src/panel.tsx'), execution: EXECUTION, root: '/elsewhere',
    });
    expect(result.execution?.opportunities).toBeUndefined();
    expect(result.execution?.withheld).toContain('rooted differently');
    expect(formatDistillation(result)).not.toContain('distillation opportunity at depth');
  });

  it('names addressed source no entered module matched, rather than dropping it', () => {
    const eyes = addressedAt('/repo/src/panel.tsx', '/repo/src/uninstrumented.tsx');
    const result = distill({ test: 'redraw-test', eyes, execution: EXECUTION, root: '/repo' });
    expect(result.execution?.opportunities).toEqual([{ file: 'src/top-nav.tsx', distance: 5 }]);
    expect(result.execution?.addressedNotEntered).toEqual(['src/uninstrumented.tsx']);
    expect(formatDistillation(result))
      .toContain('addressed, not covered — src/uninstrumented.tsx');
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
    expect(text).toContain('Loaded but not covered: 1 module(s).');
    expect(text).toContain('never covered: formatTotal (lines 3-6)');
    expect(text).toContain("substitution to try: vi.mock('src/format-total.ts')");
    // The proposal is a candidate, and the top level is what mocking also takes.
    expect(text).toContain('Mocking removes the top level too');
  });

  it('proposes nothing for a module whose top level is all it declares', () => {
    // Constants and a barrel of re-exports: the import ran every line the file
    // has, so there is no declaration below the top level the test left alone.
    const execution: ExecutionIndex = {
      tests: [{ id: 'reads', file: 'test/reads.case.ts', name: 'reads the limits' }],
      modules: [
        { file: 'src/limits.ts', blocks: [region('module', '', 1, 3, [{ test: 0, distance: 0 }])] },
        { file: 'src/index.ts', blocks: [region('module', '', 1, 2, [{ test: 0, distance: 0 }])] },
      ],
    };
    const result = distill({ test: 'reads', execution });
    expect(result.execution?.modules).toMatchObject([
      { file: 'src/index.ts', loadedOnly: false, entered: [], unentered: [] },
      { file: 'src/limits.ts', loadedOnly: false, entered: [], unentered: [] },
    ]);
    const text = formatDistillation(result);
    expect(text).toContain('Loaded but not covered: 0 module(s).');
    expect(text).not.toContain('substitution to try');
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
