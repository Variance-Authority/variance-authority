import { describe, expect, it } from 'vitest';
import { beforeReach, relationsOfFiles } from '@variance-authority/core/relate';
import { affectedSubjects, indexOf } from './affected.js';
import { reachOf } from './reach-subjects.js';
import { collectorOf, configOf, documentFor, runWith, storeAnswering, whiteBaselineOf } from './run-fixture.js';
import type { Collected, Plan } from './run.js';

const SOURCE = indexOf(
  new Map([
    ['src/ds/Button.tsx', 'export function Button() { return null }'],
    ['src/ds/Clock.tsx', 'export const Clock = () => null'],
  ]),
);

const ROOTS = ['src'];
const PLANNED = ['story:button', 'story:clock'];
const BASELINES = new Map<string, readonly string[] | undefined>([
  ['story:button', ['Button']],
  ['story:clock', ['Clock']],
]);

// The suite rests on a global stylesheet, `Button` imports its own, and
// `Clock` reads its stylesheet's bytes and says so with a `/// <depends>`.
const GRAPH = relationsOfFiles([
  { file: 'src/global.css' },
  { file: 'src/ds/button.css' },
  { file: 'src/ds/clock.css' },
  { file: 'src/ds/Button.tsx', declares: ['Button'], edges: [{ to: 'src/ds/button.css', kind: 'asset' }] },
  { file: 'src/ds/Clock.tsx', declares: ['Clock'], edges: [{ to: 'src/ds/clock.css', kind: 'depends' }] },
]);

const BEFORE = beforeReach(GRAPH, ['src/global.css'], { sensed: ROOTS });
const CSS = ['**/*.css'];

function answerFor(changed: readonly string[], ignore: readonly string[] | undefined, graph = true) {
  return affectedSubjects({
    planned: PLANNED,
    changed,
    source: SOURCE,
    roots: ROOTS,
    baselines: BASELINES,
    ...(graph ? { relations: GRAPH, before: BEFORE } : {}),
    ...(ignore === undefined ? {} : { ignore }),
  });
}

/**
 * A suite's `ignore` under `variance run`: a changed file it matches selects
 * none of its subjects by anything the run infers — the import and asset edges
 * into it, the component index, what the suite rests on — and still selects the
 * subjects whose modules declare it with a `/// <depends>`.
 */
describe('a changed file the suite ignores', () => {
  it('does not run the suite whole when the suite rests on it', () => {
    const answer = answerFor(['src/global.css'], CSS);

    expect(answer.whole).toBeUndefined();
    expect(answer.observe).toEqual([]);
  });

  it('still runs the suite whole when the suite rests on it and does not ignore it', () => {
    const answer = answerFor(['src/global.css'], undefined);

    expect(answer.observe).toEqual(PLANNED);
    expect(answer.whole).toContain('src/global.css');
  });

  it('reaches no component through the edge that imports it', () => {
    const answer = answerFor(['src/ds/button.css'], CSS);

    expect(answer.observe).toEqual([]);
    expect(answer.because).toContain('src/ds/button.css');
  });

  it('reaches the component of a module that declares it with a `/// <depends>`', () => {
    const answer = answerFor(['src/ds/clock.css', 'src/ds/button.css'], CSS);

    expect(answer.observe).toEqual(['story:clock']);
  });

  it('is taken back by a negated pattern', () => {
    const answer = answerFor(['src/ds/button.css'], [...CSS, '!src/ds/button.css']);

    expect(answer.observe).toEqual(['story:button']);
  });

  it('does not run the suite whole without a file graph', () => {
    const answer = answerFor(['src/ds/button.css'], CSS, false);

    expect(answer.whole).toBeUndefined();
    expect(answer.observe).toEqual([]);
    expect(answer.because).toContain('src/ds/button.css');
  });

  it('leaves the files it does not match to the selector without a file graph', () => {
    const answer = answerFor(['src/ds/button.css', 'src/ds/Clock.tsx'], CSS, false);

    expect(answer.observe).toEqual(['story:clock']);
  });

  it('reaches nothing when the file graph does not hold it', () => {
    const answer = answerFor(['src/ds/new.css'], CSS);

    expect(answer.observe).toEqual([]);
    expect(answer.because).toContain('the suite ignores src/ds/new.css');
  });

  it('is named beside a file that changes nothing that runs, without a file graph', () => {
    const answer = affectedSubjects({
      planned: PLANNED,
      changed: ['src/ds/button.css', 'src/ds/Clock.tsx'],
      source: SOURCE,
      roots: ROOTS,
      baselines: BASELINES,
      movedExports: new Map([['src/ds/Clock.tsx', []]]),
      ignore: CSS,
    });

    expect(answer.observe).toEqual([]);
    expect(answer.because).toContain('src/ds/Clock.tsx changes nothing that runs, and the suite ignores src/ds/button.css');
  });

  it('is read by the report as the selector reads it', () => {
    const reach = reachOf({
      against: 'main',
      changed: ['src/global.css', 'src/ds/clock.css'],
      relations: GRAPH,
      roots: ROOTS,
      before: BEFORE,
      baselines: BASELINES,
      ignore: CSS,
    });

    expect(reach.whole).toBeUndefined();
    expect(reach.components.map((entry) => entry.component)).toEqual(['Clock']);
  });
});

const PLAN: Plan = {
  subjects: [{ subject: { id: 'fixture:a', kind: 'fixture' } }],
  notObserved: [],
  warnings: [],
};

describe('a run whose suite ignores what it rests on', () => {
  it('narrows a diff of that file alone, and says the suite ignored it', async () => {
    const baseline = whiteBaselineOf(documentFor('fixture:a'));
    const store = storeAnswering({
      ...baseline,
      raster: { ...baseline.raster, components: [{ component: 'Button', instances: 1, structure: 'v1:s' }] },
    });
    const collector = collectorOf(PLAN, (subject): Collected => ({ ok: true, document: documentFor(subject.subject.id) }));

    const { report } = await runWith(
      configOf({ source: { dirs: ROOTS, relations: true }, before: ['src/global.css'] }),
      collector,
      store,
      {
        since: { ref: 'origin/main', changed: ['src/global.css'] },
        ignore: CSS,
        scanSource: async () => SOURCE,
        scanRelations: async () => GRAPH,
      },
    );

    expect(report.observations).toEqual([]);
    expect(report.warnings.join('\n')).toContain('the suite ignores src/global.css');
  });
});
