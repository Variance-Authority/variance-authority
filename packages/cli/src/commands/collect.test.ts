import { describe, expect, it } from 'vitest';
import { collectEvidence, type CollectInput } from './collect.js';
import { collecting, onEngine, planOf, rendered, type Opened } from './evidence-fixture.js';
import { recipeOf, type EvidencePart } from './evidence-part.js';
import { configOf } from './run-fixture.js';
import { assign } from './shard.js';
import type { Collected } from './collector.js';

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
