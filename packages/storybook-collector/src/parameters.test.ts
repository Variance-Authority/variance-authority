import { describe, expect, it } from 'vitest';
import type { Viewport } from '@variance-authority/core/format';
import type { Plan, PlannedSubject } from './contract.js';
import { storyIdOf, withParameters } from './parameters.js';

/**
 * The plan after each story has had its say.
 *
 * The index plans every story once at the run's viewport; a story's
 * `parameters.variance` takes it out, resizes it or reads it at several widths.
 * What these tests hold is that each of those is visible in the plan — an
 * exclusion in `notObserved` with its reason, a width in the subject id — and
 * that a story with nothing to say is the subject it was before.
 */

const RUN: Viewport = { width: 1280, height: 800, deviceScaleFactor: 1, colorScheme: 'light' };

const planned = (id: string): PlannedSubject => ({ subject: { id: `story:${id}`, kind: 'story' } });

const planOf = (...ids: string[]): Plan => ({ subjects: ids.map(planned), notObserved: [], warnings: [] });

describe('story parameters over the plan', () => {
  it('leaves a story with no `variance` parameters exactly as the index planned it', () => {
    const plan = planOf('button--primary', 'button--secondary');

    expect(withParameters(plan, { parameters: {} }, RUN)).toEqual(plan);
  });

  it('moves an excluded story to `notObserved` with the reason the story gave', () => {
    const next = withParameters(planOf('button--primary', 'chart--live'), { parameters: { 'chart--live': { exclude: true } } }, RUN);

    expect(next.subjects.map((entry) => entry.subject.id)).toEqual(['story:button--primary']);
    expect(next.notObserved).toEqual([
      {
        subject: 'story:chart--live',
        kind: 'excluded',
        because: 'excluded by its own parameters (`variance.exclude`)',
      },
    ]);
  });

  it('excludes a story whose parameters it cannot read, rather than reading it at the run size', () => {
    const next = withParameters(planOf('grid--wide'), { parameters: { 'grid--wide': { widths: ['wide'] } } }, RUN);

    expect(next.subjects).toEqual([]);
    expect(next.notObserved).toHaveLength(1);
  });

  it('reads a story once per width, each its own subject', () => {
    const next = withParameters(planOf('page--home'), { parameters: { 'page--home': { widths: [1280, 375, 375] } } }, RUN);

    // Both widths name the story that declared them, so a shard never splits them.
    const home = { ...planned('page--home'), declaredIn: 'story:page--home' };
    expect(next.subjects).toEqual([
      { ...home, subject: { ...home.subject, id: 'story:page--home@375' }, viewport: { ...RUN, width: 375 } },
      { ...home, subject: { ...home.subject, id: 'story:page--home@1280' }, viewport: RUN },
    ]);
  });

  it("lays the widths over the story's own viewport, not the run's", () => {
    const next = withParameters(
      planOf('page--home'),
      { parameters: { 'page--home': { viewport: { colorScheme: 'dark' }, widths: [375] } } },
      RUN,
    );

    expect(next.subjects.map((entry) => entry.viewport)).toEqual([{ ...RUN, colorScheme: 'dark', width: 375 }]);
  });

  it('keeps one subject id for a resized story, so its baseline stays where it was', () => {
    const next = withParameters(planOf('card--dark'), { parameters: { 'card--dark': { viewport: { colorScheme: 'dark' } } } }, RUN);

    expect(next.subjects).toEqual([{ ...planned('card--dark'), viewport: { ...RUN, colorScheme: 'dark' } }]);
  });

  it('says so when the preview could not be asked, and reads the plan unchanged', () => {
    const plan = planOf('button--primary');
    const next = withParameters(plan, { unread: 'the preview could not list its stories: boom' }, RUN);

    expect(next.subjects).toEqual(plan.subjects);
    expect(next.warnings).toHaveLength(1);
    expect(next.warnings[0]).toContain('boom');
  });
});

describe('the story a subject id names', () => {
  it('drops the namespace and the width suffix', () => {
    expect(storyIdOf('story:page--home')).toBe('page--home');
    expect(storyIdOf('story:page--home@375')).toBe('page--home');
  });
});
