import { describe, expect, it } from 'vitest';
import type { Viewport } from '@variance-authority/core/format';
import type { PlannedSubject } from './contract.js';
import { realize, storyIdOf } from './parameters.js';

/**
 * A story, once it has had its say.
 *
 * The plan holds every story once, from the index; reaching a story reads its
 * `parameters.variance`, which takes it out, resizes it or reads it at several
 * widths. What these tests hold is that each of those is visible in what the
 * visit realizes — an exclusion with its reason, a width in the subject id — and
 * that a story with nothing to say is the subject it was before.
 */

const RUN: Viewport = { width: 1280, height: 800, deviceScaleFactor: 1, colorScheme: 'light' };

const planned = (id: string): PlannedSubject => ({ subject: { id: `story:${id}`, kind: 'story' } });

describe('a story realized from its own parameters', () => {
  it('leaves a story with no `variance` parameters exactly as the index planned it', () => {
    expect(realize(planned('button--primary'), {}, RUN)).toEqual({ subjects: [planned('button--primary')] });
  });

  it('excludes a story with the reason the story gave', () => {
    expect(realize(planned('chart--live'), { parameters: { exclude: true } }, RUN)).toEqual({
      excluded: 'excluded by its own parameters (`variance.exclude`)',
    });
  });

  it('excludes a story whose parameters it cannot use, rather than reading it at the run size', () => {
    expect(realize(planned('grid--wide'), { parameters: { widths: ['wide'] } }, RUN)).toHaveProperty('excluded');
  });

  it('reads a story once per width, each its own subject', () => {
    const home = { ...planned('page--home'), name: 'Home' };

    // Both widths name the story that declared them, so a shard never splits them.
    expect(realize(home, { parameters: { widths: [1280, 375, 375] } }, RUN)).toEqual({
      subjects: [
        { ...home, subject: { ...home.subject, id: 'story:page--home@375' }, name: 'Home @375', declaredIn: 'story:page--home', viewport: { ...RUN, width: 375 } },
        { ...home, subject: { ...home.subject, id: 'story:page--home@1280' }, name: 'Home @1280', declaredIn: 'story:page--home', viewport: RUN },
      ],
    });
  });

  it("lays the widths over the story's own viewport, not the run's", () => {
    const realized = realize(planned('page--home'), { parameters: { viewport: { colorScheme: 'dark' }, widths: [375] } }, RUN);

    expect('subjects' in realized && realized.subjects.map((entry) => entry.viewport)).toEqual([
      { ...RUN, colorScheme: 'dark', width: 375 },
    ]);
  });

  it('keeps one subject id for a resized story, so its baseline stays where it was', () => {
    expect(realize(planned('card--dark'), { parameters: { viewport: { colorScheme: 'dark' } } }, RUN)).toEqual({
      subjects: [{ ...planned('card--dark'), viewport: { ...RUN, colorScheme: 'dark' } }],
    });
  });

  it('reads one width alone when it is asked for by its own id, at the width the story declares now', () => {
    const width = { ...planned('page--home@375'), name: 'Home @375', viewport: { ...RUN, width: 375, colorScheme: 'light' as const } };

    expect(realize(width, { parameters: { viewport: { colorScheme: 'dark' }, widths: [375, 1280] } }, RUN)).toEqual({
      subjects: [{ ...width, viewport: { ...RUN, colorScheme: 'dark', width: 375 } }],
    });
  });

  it('refuses a width the story no longer declares, rather than reading it at a size nothing asked for', () => {
    expect(realize(planned('page--home@375'), { parameters: { widths: [800] } }, RUN)).toEqual({
      refused: 'story `page--home` no longer declares the width `story:page--home@375` reads at; it declares 800',
    });
    expect(realize(planned('page--home@375'), {}, RUN)).toHaveProperty('refused');
    expect(realize(planned('page--home@375'), { parameters: { widths: [1280, 800, 1280] } }, RUN)).toEqual({
      refused: 'story `page--home` no longer declares the width `story:page--home@375` reads at; it declares 800, 1280',
    });
  });

  it('says so when the preview could not be asked, and reads the story as planned', () => {
    const realized = realize(planned('button--primary'), { unread: 'the preview could not load the story: boom' }, RUN);

    expect(realized).toMatchObject({ subjects: [planned('button--primary')] });
    expect('warning' in realized && realized.warning).toContain('boom');
  });

  // Unread parameters hide the widths the story declares, so the visit cannot
  // say which subjects the story is: the run must not read its silence as none.
  it('says the story may be more than it read when its parameters were not read', () => {
    for (const read of [{ unread: 'boom' }, { unsupported: 'no loadStory' }]) {
      expect(realize(planned('button--primary'), read, RUN)).toMatchObject({ incomplete: true });
    }
    expect(realize(planned('button--primary'), { parameters: {} }, RUN)).not.toHaveProperty('incomplete');
  });

  // A preview with no `loadStory` cannot read any story's parameters, so it is
  // one fact about the run: said once, not once per story.
  it('says a preview that cannot read parameters in the same words for every story', () => {
    const read = { unsupported: 'the preview has no `__STORYBOOK_PREVIEW__.loadStory`' };
    const first = realize(planned('button--primary'), read, RUN);
    const second = realize(planned('card--receipt'), read, RUN);

    expect(first).toMatchObject({ subjects: [planned('button--primary')] });
    expect('warning' in first && first.warning).toContain('loadStory');
    expect('warning' in second && second.warning).toBe('warning' in first && first.warning);
  });
});

describe('the story a subject id names', () => {
  it('drops the namespace and the width suffix', () => {
    expect(storyIdOf('story:page--home')).toBe('page--home');
    expect(storyIdOf('story:page--home@375')).toBe('page--home');
  });
});
