import { describe, expect, it } from 'vitest';
import { collectEvidence, type CollectInput } from './collect.js';
import { collecting, onEngine, planOf, rendered, type Opened } from './evidence-fixture.js';
import { recipeOf, type EvidencePart } from './evidence-part.js';
import { configOf } from './run-fixture.js';
import { assign } from './shard.js';
import type { Collected, Visit } from './collector.js';
import { mergeEvidence } from './collect-merge.js';

const PLAN = planOf([
  ['button--primary', 'src/Button.stories.tsx'],
  ['button--quiet', 'src/Button.stories.tsx'],
  ['card--default', 'src/Card.stories.tsx'],
  ['menu--open', 'src/Menu.stories.tsx'],
  ['page--home', 'src/Page.stories.tsx'],
]);

function answer(id: string): Collected {
  return rendered(id, [
    { owner: id.startsWith('button') ? 'Button' : 'Card', text: `Read ${id}`, file: 'src/Button.tsx' },
    { owner: 'Icon', text: 'Close' },
  ]);
}

function inputOf(opened: Opened, overrides: Partial<CollectInput> = {}): CollectInput {
  return {
    collector: opened.collector,
    config: configOf({ workers: 2 }),
    build: { commit: 'c0ffee' },
    recipe: recipeOf({ cli: 'test' }),
    ...overrides,
  };
}

describe('collectEvidence: one job of a collection, with nothing compared', () => {
  it('accounts for every owned subject in plan order, and keeps what the index is counted from', async () => {
    const opened = collecting(PLAN, answer);
    const part = await collectEvidence(inputOf(opened));

    expect(part.outcomes.map((outcome) => [outcome.position, outcome.subject, outcome.outcome])).toEqual([
      [0, 'button--primary', 'collected'],
      [1, 'button--quiet', 'collected'],
      [2, 'card--default', 'collected'],
      [3, 'menu--open', 'collected'],
      [4, 'page--home', 'collected'],
    ]);
    expect(part.subjects.map((row) => row.position)).toEqual([0, 1, 2, 3, 4]);
    expect(part.subjects[0]!.instances.map((instance) => instance.component)).toEqual(['(unattributed)', 'Button', 'Icon']);
    expect(part.subjects[0]!.lexicon.fields.text).toEqual(['Close', 'Read button--primary']);
    expect(part.fields).toEqual(['example', 'components', 'createdBy', 'tokens', 'names', 'text', 'roles', 'files']);
    expect(JSON.stringify(part)).not.toContain('renderHash');
    expect(opened.worlds).toEqual({ opened: 2, closed: 2 });
  });

  it('says once each environment its snapshots were read in, as the engine reported it', async () => {
    const part = await collectEvidence(inputOf(collecting(PLAN, (id) => (id === 'menu--open' ? onEngine(answer(id), 'chromium@132') : answer(id)))));

    expect(part.environments).toEqual([
      { profile: 'chromium', engine: 'chromium@131', ruleset: 'test', allowlist: 'test', fonts: [] },
      { profile: 'chromium', engine: 'chromium@132', ruleset: 'test', allowlist: 'test', fonts: [] },
    ]);
    expect((await collectEvidence(inputOf(collecting(PLAN, (id) => rendered(id))))).environments).toEqual([]);
  });

  it('collects only the file groups its shard owns, and the same ones a run would', async () => {
    const shard = { index: 2, total: 3 };
    const opened = collecting(PLAN, answer);
    const part = await collectEvidence(inputOf(opened, { shard }));

    const owned = assign(PLAN.subjects, shard, undefined).queue.flat().sort((l, r) => l - r);
    expect(part.outcomes.map((outcome) => outcome.position)).toEqual(owned);
    expect(part.shard).toEqual(shard);
    expect(part.plan.subjects).toHaveLength(5);
  });

  it('writes a valid part for a shard that owns nothing, and opens no browser for it', async () => {
    const plan = planOf([['only--one', 'src/Only.stories.tsx']]);
    const shard = [1, 2].map((index) => ({ index, total: 2 })).find((candidate) => assign(plan.subjects, candidate, undefined).queue.length === 0)!;
    const opened = collecting(plan, answer);
    const part = await collectEvidence(inputOf(opened, { shard }));

    expect(part.outcomes).toEqual([]);
    expect(part.subjects).toEqual([]);
    expect(part.fields).toBeUndefined();
    expect(opened.asked).toEqual([]);
    expect(opened.worlds).toEqual({ opened: 1, closed: 1 });
  });

  it('records a subject that failed as failed, and still collects the rest', async () => {
    const opened = collecting(PLAN, (id) => (id === 'card--default' ? { ok: false, because: 'the story threw: no theme' } : answer(id)));
    const part = await collectEvidence(inputOf(opened));

    expect(part.outcomes.filter((outcome) => outcome.outcome === 'failed')).toEqual([
      { position: 2, subject: 'card--default', outcome: 'failed', because: 'the story threw: no theme' },
    ]);
    expect(part.subjects.map((row) => row.subject)).toEqual(['button--primary', 'button--quiet', 'menu--open', 'page--home']);
    expect(opened.worlds).toEqual({ opened: 2, closed: 2 });
  });

  it('says which subjects a scope left out, and why', async () => {
    const part = await collectEvidence(inputOf(collecting(PLAN, answer), { scope: 'button--*' }));

    expect(part.outcomes.filter((outcome) => outcome.outcome === 'excluded').map((outcome) => outcome.subject)).toEqual([
      'card--default',
      'menu--open',
      'page--home',
    ]);
    expect(part.subjects).toHaveLength(2);
  });

  it('holds every width a visit read at the position the plan gave its story, and says its warning once', async () => {
    const story = PLAN.subjects[2]!;
    const atWidth = (width: number) => ({
      planned: { ...story, subject: { ...story.subject, id: `${story.subject.id}@${String(width)}` } },
      collected: answer(`${story.subject.id}@${String(width)}`),
    });
    const visit: Visit = { subjects: [atWidth(375), atWidth(800)], warnings: ['widths read from a guess'] };
    const part = await collectEvidence(inputOf(collecting(PLAN, (id) => (id === story.subject.id ? visit : answer(id)))));

    expect(part.outcomes.filter((outcome) => outcome.position === 2)).toEqual([
      { position: 2, subject: 'card--default@375', of: 'card--default', outcome: 'collected', snapshot: true },
      { position: 2, subject: 'card--default@800', of: 'card--default', outcome: 'collected', snapshot: true },
    ]);
    expect(part.subjects.filter((row) => row.position === 2).map((row) => row.subject)).toEqual([
      'card--default@375',
      'card--default@800',
    ]);
    expect(part.diagnostics.filter((diagnostic) => diagnostic.message === 'widths read from a guess')).toHaveLength(1);
    expect(mergeEvidence([{ path: 'evidence.json', part }]).kind).not.toBe('refused');
  });

  // The plan names the story and `--subjects` may name one of its widths: the
  // glob decides on what the visit realized, so the width it names is read and
  // the other is left out by the same filter that leaves out a story.
  it('reads only the width a scope names out of a visit that read two', async () => {
    const story = PLAN.subjects[2]!;
    const atWidth = (width: number) => ({
      planned: { ...story, subject: { ...story.subject, id: `${story.subject.id}@${String(width)}` } },
      collected: answer(`${story.subject.id}@${String(width)}`),
    });
    const visit: Visit = { subjects: [atWidth(375), atWidth(800)] };
    const opened = collecting(PLAN, (id) => (id === story.subject.id ? visit : answer(id)));
    const part = await collectEvidence(inputOf(opened, { scope: '*@375' }));

    expect(part.outcomes.filter((outcome) => outcome.position === 2).map((outcome) => [outcome.subject, outcome.outcome])).toEqual([
      ['card--default@375', 'collected'],
      ['card--default@800', 'excluded'],
    ]);
    expect(part.subjects.map((row) => row.subject)).toEqual(['card--default@375']);
  });

  // A visit that realized nothing read nothing, and the story the plan holds
  // must still be accounted for: it failed, at its own position.
  it('says a story failed when its visit realized no subject', async () => {
    const story = PLAN.subjects[2]!;
    const empty: Visit = { subjects: [] };
    const part = await collectEvidence(inputOf(collecting(PLAN, (id) => (id === story.subject.id ? empty : answer(id)))));

    expect(part.outcomes.filter((outcome) => outcome.position === 2)).toEqual([
      { position: 2, subject: story.subject.id, outcome: 'failed', because: 'the collector visited it and realized no subject' },
    ]);
  });

  // A visit realizes its story or the story at a width. A story whose id merely
  // begins with the planned one is another story, and filing it at this
  // position would be a reading the plan never asked for.
  it('fails a story whose visit realized a subject that is not it or one of its widths', async () => {
    const story = PLAN.subjects[2]!;
    const as = (id: string) => ({ planned: { ...story, subject: { ...story.subject, id } }, collected: answer(id) });
    const stray: Visit = { subjects: [as(`${story.subject.id}@375`), as(`${story.subject.id}-large`)] };
    const part = await collectEvidence(inputOf(collecting(PLAN, (id) => (id === story.subject.id ? stray : answer(id)))));

    expect(part.outcomes.filter((outcome) => outcome.position === 2)).toEqual([
      {
        position: 2,
        subject: story.subject.id,
        outcome: 'failed',
        because: `the collector realized \`${story.subject.id}-large\`, which is neither \`${story.subject.id}\` nor one of its widths`,
      },
    ]);
  });

  it('keeps a collected subject with no snapshot as collected, with no row', async () => {
    const part = await collectEvidence(inputOf(collecting(PLAN, (id) => rendered(id))));

    expect(part.outcomes.every((outcome) => outcome.outcome === 'collected' && !outcome.snapshot)).toBe(true);
    expect(part.subjects).toEqual([]);
    expect(part.fields).toBeUndefined();
  });

  it('writes the same part whichever world finishes first', async () => {
    const order = (delays: Record<string, number>) =>
      collectEvidence(inputOf(collecting(PLAN, located, { delay: (id) => delays[id] ?? 0 })));
    const early = await order({ 'button--primary': 30, 'card--default': 1 });
    const late = await order({ 'card--default': 30, 'page--home': 15 });

    expect(untimed(late)).toEqual(untimed(early));
    expect(early.declaredIn).toEqual({ Button: ['src/a/Button.tsx'] });
  });

  it('closes every world it opened when a second one cannot be opened', async () => {
    const opened = collecting(PLAN, answer, { failOpening: 2 });
    await expect(collectEvidence(inputOf(opened, { config: configOf({ workers: 3 }) }))).rejects.toThrow('no second browser');
    expect(opened.worlds).toEqual({ opened: 2, closed: 2 });
  });

  it('lays the scan into the rows, under what the engine located, as a run does', async () => {
    const source = { Button: [{ file: 'src/Button.tsx', line: 1, via: 'function' as const }], Card: [{ file: 'src/Card.tsx', line: 1, via: 'function' as const }] };
    const part = await collectEvidence(inputOf(collecting(PLAN, located), { source }));

    expect(part.declaredIn).toEqual({ Button: ['src/a/Button.tsx'], Card: ['src/Card.tsx'] });
    expect(part.subjects[0]!.lexicon.fields.files).toEqual(['src/Button.tsx', 'src/a/Button.tsx']);
    expect(part.fields).toContain('files');
  });

  it("says what the plan warned and what each subject's collector said, by subject, in plan order", async () => {
    const said = (id: string): Collected => {
      const collected = answer(id);
      if (!collected.ok || (id !== 'menu--open' && id !== 'button--quiet')) return collected;
      return { ...collected, diagnostics: [{ severity: 'warn', code: 'font', message: `${id} fell back to a system font` }] };
    };
    const part = await collectEvidence(inputOf(collecting({ ...PLAN, warnings: ['two stories share one id'] }, said)));

    expect(part.diagnostics).toEqual([
      { severity: 'warn', code: 'plan', message: 'two stories share one id' },
      { subject: 'button--quiet', severity: 'warn', code: 'font', message: 'button--quiet fell back to a system font' },
      { subject: 'menu--open', severity: 'warn', code: 'font', message: 'menu--open fell back to a system font' },
    ]);
  });
});

/** Two subjects locate `Button` in two places; the answer is the same in any order. */
function located(id: string): Collected {
  const file = id === 'card--default' ? 'src/b/Button.tsx' : 'src/a/Button.tsx';
  const collected = answer(id);
  if (!collected.ok || (id !== 'card--default' && id !== 'button--primary')) return collected;
  return { ...collected, source: { Button: [{ file, line: 1, via: 'engine' as const }] } };
}

function untimed({ acquisition: _timed, ...rest }: EvidencePart): Omit<EvidencePart, 'acquisition'> {
  return rest;
}
