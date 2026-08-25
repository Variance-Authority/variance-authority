import {
  CHROMIUM_PROFILE,
  JSDOM_PROFILE,
  digestValue,
  environmentKey,
  type Diagnostic,
  type ObservationProfile,
  type SemanticSnapshot,
} from '@variance-authority/core';
import { describe, expect, it } from 'vitest';
import {
  assessScenarios,
  defineScenario,
  foldScenarios,
  recordAct,
  startScenario,
  unobserved,
} from './index.js';

const FAILURE: Diagnostic = { severity: 'error', code: 'capture-failed', message: 'page closed' };

function snapshot(
  subject: string,
  text: string,
  color = 'black',
  profile: ObservationProfile = CHROMIUM_PROFILE,
): SemanticSnapshot {
  const environment = environmentKey({
    profile: profile.id,
    engine: profile.id === 'chromium' ? 'chromium@1' : 'jsdom@1',
    ruleset: 'rules@1',
    allowlist: 'allowlist@1',
    viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
    fonts: [],
    conditions: {},
    assets: {},
  });
  const root = {
    path: '0',
    tag: 'button',
    attributes: {},
    style: { color },
    ...(profile.layout ? { rect: { x: 0, y: 0, width: 100, height: 40 } } : {}),
    text,
    children: [],
  } as const;

  return {
    formatVersion: 1,
    subject: { id: subject, kind: 'fixture' },
    profile,
    environment,
    renderHash: digestValue({ text, color, profile: profile.id }),
    structureHash: digestValue({ tag: 'button', text }),
    styleHash: digestValue({ color }),
    root,
    styleProvenance: [],
    diagnostics: [],
  };
}

function completed(
  id: string,
  subject: string,
  before: SemanticSnapshot,
  after: SemanticSnapshot,
) {
  const definition = defineScenario('delete-an-article', [{ key: 'delete-first' }]);
  const started = startScenario(
    definition,
    { id, precondition: { id: subject, kind: 'fixture' }, profile: before.profile.id },
    before,
  );
  return recordAct(started, 'delete-first', after);
}

describe('recording a witnessed AAA path', () => {
  it('records Arrange at zero and authored Act occurrences without event payloads', () => {
    const definition = defineScenario('retry-save', [{ key: 'save' }, { key: 'save' }]);
    let run = startScenario(
      definition,
      {
        id: 'execution-1',
        precondition: { id: 'page-error', kind: 'fixture' },
        profile: 'chromium',
        preconditionLink: {
          kind: 'resolved',
          parent: 'page',
          how: 'named',
          step: { axis: 'state', from: 'default', to: 'error' },
        },
      },
      snapshot('page-error', 'Error'),
    );
    run = recordAct(run, 'save', snapshot('page-error', 'Retrying'));
    run = recordAct(run, 'save', snapshot('page-error', 'Saved'));

    expect(run.execution.frames.map((frame) => frame.at)).toEqual([0, 1, 2]);
    expect(run.execution.frames.map((frame) => frame.act)).toEqual([
      undefined,
      { key: 'save', occurrence: 1 },
      { key: 'save', occurrence: 2 },
    ]);
    expect(run.execution.preconditionLink).toMatchObject({ how: 'named', parent: 'page' });
  });

  it('terminates at an unobserved outcome and refuses synthetic later frames', () => {
    const definition = defineScenario('save', [{ key: 'save' }, { key: 'dismiss' }]);
    const started = startScenario(
      definition,
      {
        id: 'execution-2',
        precondition: { id: 'page', kind: 'fixture' },
        profile: 'chromium',
      },
      snapshot('page', 'Ready'),
    );
    const failed = recordAct(started, 'save', unobserved(FAILURE));

    expect(failed.execution.frames).toHaveLength(2);
    expect(failed.execution.frames[1]?.outcome).toEqual({
      kind: 'unobserved',
      diagnostics: [FAILURE],
    });
    expect(() => recordAct(failed, 'dismiss', snapshot('page', 'Dismissed'))).toThrow(
      'after the scenario became unobserved',
    );
  });

  it('records a failed Arrange as an explicit terminal observation', () => {
    const failed = startScenario(
      defineScenario('load', [{ key: 'retry' }]),
      {
        id: 'execution-arrange-failed',
        precondition: { id: 'page-loading', kind: 'fixture' },
        profile: 'chromium',
      },
      unobserved(FAILURE),
    );

    expect(failed.execution.frames).toEqual([
      { at: 0, outcome: { kind: 'unobserved', diagnostics: [FAILURE] } },
    ]);
    expect(failed.execution.termination).toEqual([FAILURE]);
  });

  it('refuses a shifted ordinal instead of guessing which authored Act it meant', () => {
    const definition = defineScenario('ordered', [{ key: 'open' }, { key: 'confirm' }]);
    const run = startScenario(
      definition,
      {
        id: 'execution-3',
        precondition: { id: 'page', kind: 'fixture' },
        profile: 'chromium',
      },
      snapshot('page', 'Ready'),
    );

    expect(() => recordAct(run, 'confirm', snapshot('page', 'Done'))).toThrow('expects `open`');
  });
});

describe('assessing effects rather than confusing three variances', () => {
  it('keeps Arrange variation separate while equal transition effects agree', () => {
    const left = completed(
      'left',
      'page-one-article',
      snapshot('page-one-article', 'Ready', 'blue'),
      snapshot('page-one-article', 'Done', 'blue'),
    );
    const right = completed(
      'right',
      'page-two-articles',
      snapshot('page-two-articles', 'Ready', 'green'),
      snapshot('page-two-articles', 'Done', 'green'),
    );
    const assessment = assessScenarios(left, right);

    expect(assessment.arrange).toMatchObject({
      kind: 'measured',
      variance: { identical: false, bands: ['token'] },
    });
    expect(assessment.transitions[0]?.divergence).toMatchObject({
      kind: 'measured',
      identical: true,
    });
    expect(assessment.firstDivergence).toEqual({ kind: 'none' });
  });

  it('names the first Act whose transition effect changes', () => {
    const left = completed(
      'left',
      'page-one-article',
      snapshot('page-one-article', 'Ready'),
      snapshot('page-one-article', 'Done'),
    );
    const right = completed(
      'right',
      'page-two-articles',
      snapshot('page-two-articles', 'Ready'),
      snapshot('page-two-articles', 'Failed'),
    );

    expect(assessScenarios(left, right).firstDivergence).toEqual({
      kind: 'found',
      act: { key: 'delete-first', occurrence: 1 },
    });
  });

  it('stops alignment at an inserted Act and reports every unmatched identity', () => {
    const leftDefinition = defineScenario('left-path', [{ key: 'open' }, { key: 'confirm' }]);
    const rightDefinition = defineScenario('right-path', [
      { key: 'open' },
      { key: 'inspect' },
      { key: 'confirm' },
    ]);
    let left = startScenario(
      leftDefinition,
      { id: 'left', precondition: { id: 'page', kind: 'fixture' }, profile: 'chromium' },
      snapshot('page', 'Closed'),
    );
    left = recordAct(left, 'open', snapshot('page', 'Open'));
    left = recordAct(left, 'confirm', snapshot('page', 'Done'));
    let right = startScenario(
      rightDefinition,
      { id: 'right', precondition: { id: 'page', kind: 'fixture' }, profile: 'chromium' },
      snapshot('page', 'Closed'),
    );
    right = recordAct(right, 'open', snapshot('page', 'Open'));
    right = recordAct(right, 'inspect', snapshot('page', 'Open'));
    right = recordAct(right, 'confirm', snapshot('page', 'Done'));

    const assessment = assessScenarios(left, right);
    expect(assessment.transitions).toHaveLength(1);
    expect(assessment.unmatched).toEqual([
      { key: 'confirm', occurrence: 1, side: 'left' },
      { key: 'inspect', occurrence: 1, side: 'right' },
      { key: 'confirm', occurrence: 1, side: 'right' },
    ]);
    expect(assessment.firstDivergence.kind).toBe('unresolved');
  });

  it('names the profile-blind side rather than reporting absent geometry as equal', () => {
    const jsdom = completed(
      'unit',
      'page',
      snapshot('page', 'Ready', 'black', JSDOM_PROFILE),
      snapshot('page', 'Done', 'black', JSDOM_PROFILE),
    );
    const chromium = completed(
      'browser',
      'page-browser',
      snapshot('page-browser', 'Ready'),
      snapshot('page-browser', 'Done'),
    );

    const arrange = assessScenarios(jsdom, chromium).arrange;
    expect(arrange).toMatchObject({ kind: 'measured' });
    if (arrange.kind !== 'measured') throw new Error('expected measured Arrange');
    expect(arrange.variance.blindSides).toContainEqual({ band: 'geometry', sides: ['left'] });
  });
});

describe('folding witnessed paths into a partial machine', () => {
  it('joins converged states and preserves two destinations for one state and Act', () => {
    const first = completed(
      'first',
      'page-one',
      snapshot('page-one', 'Ready'),
      snapshot('page-one', 'Done'),
    );
    const second = completed(
      'second',
      'page-two',
      snapshot('page-two', 'Ready'),
      snapshot('page-two', 'Failed'),
    );
    const machine = foldScenarios([first, second]);

    expect(machine.nodes).toHaveLength(3);
    expect(machine.transitions).toHaveLength(2);
    expect(machine.divergences).toEqual([
      {
        from: snapshot('irrelevant', 'Ready').renderHash,
        act: 'delete-first',
        destinations: [
          snapshot('irrelevant', 'Done').renderHash,
          snapshot('irrelevant', 'Failed').renderHash,
        ].sort(),
      },
    ]);
  });

  it('keeps an unobserved Act as unknown rather than inventing an edge', () => {
    const definition = defineScenario('delete', [{ key: 'delete-first' }]);
    const started = startScenario(
      definition,
      { id: 'failed', precondition: { id: 'page', kind: 'fixture' }, profile: 'chromium' },
      snapshot('page', 'Ready'),
    );
    const failed = recordAct(started, 'delete-first', unobserved(FAILURE));
    const machine = foldScenarios([failed]);

    expect(machine.transitions).toEqual([]);
    expect(machine.unknown).toMatchObject([
      { act: { key: 'delete-first', occurrence: 1 }, because: 'page closed' },
    ]);
  });

  it('refuses a forged path whose structural shape crosses a terminal outcome', () => {
    const definition = defineScenario('delete', [{ key: 'delete-first' }, { key: 'retry' }]);
    const started = startScenario(
      definition,
      { id: 'forged', precondition: { id: 'page', kind: 'fixture' }, profile: 'chromium' },
      snapshot('page', 'Ready'),
    );
    const failed = recordAct(started, 'delete-first', unobserved(FAILURE));
    const forged = {
      ...failed,
      execution: {
        ...failed.execution,
        frames: [
          ...failed.execution.frames,
          { at: 2, act: { key: 'retry', occurrence: 1 }, outcome: failed.execution.frames[0]!.outcome },
        ],
      },
    } as typeof failed;

    expect(() => foldScenarios([forged])).toThrow('after an unobserved outcome');
  });
});
