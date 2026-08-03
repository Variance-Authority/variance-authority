import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Viewport } from '@variance-authority/core';
import type { StoryIndex } from './index-file.js';
import { readStoryIndex } from './read.js';
import { toSubjects, type StoryParameters, type SubjectPlan } from './subjects.js';

/**
 * Policy over an index: which stories a run observes, in what order, at what size.
 *
 * Every test here is about something that is invisible when it goes wrong. A
 * dropped subject looks like a passing subject; a machine-dependent order moves
 * pollution blame from one story to another; a viewport override silently
 * ignored produces a baseline of the right component at the wrong width, which
 * then disagrees with itself on the next run for no reason anyone can find.
 */

const VIEWPORT: Viewport = { width: 1280, height: 800, deviceScaleFactor: 1, colorScheme: 'light' };

const load = (name: string): Promise<StoryIndex> =>
  readStoryIndex(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)));

describe('mapping stories to subjects', () => {
  it('orders subjects by title then name, not by the index key order', async () => {
    // JSON key order is whatever the builder's file walk produced, which varies
    // by filesystem. ADR-0009 blames the *earlier* subject for a leak, so an
    // order that varies by machine produces findings that do too.
    const plan = toSubjects(await load('index-v5.json'));

    expect(plan.subjects.map((entry) => entry.story.id)).toEqual([
      'components-alert--danger',
      'components-button--disabled',
      'components-button--primary',
      'layout-stack--basic',
    ]);
  });

  it('keys each subject on its story id, namespaced by kind', async () => {
    // Baselines are keyed on this. A bare `button--primary` collides with a
    // route of the same name the first time a project has both.
    const plan = toSubjects(await load('index-v5.json'));

    expect(plan.subjects[0]?.subject).toEqual({
      id: 'story:components-alert--danger',
      kind: 'story',
      title: 'Components/Alert/Danger',
    });
  });

  it('carries the index exclusions into the plan so a run can state every skip', async () => {
    // The docs entry the reader set aside has to survive into the artifact a
    // person reads. Silence about a subject is indistinguishable from a pass.
    const plan = toSubjects(await load('index-v5.json'));

    expect(plan.excluded.map((entry) => entry.id)).toEqual(['components-button--docs']);
  });

  it('produces no subjects, and says why, for an index of nothing but docs', async () => {
    // The dangerous shape: a run that observes nothing and exits green. The plan
    // has to be able to explain itself rather than merely be empty.
    const plan = toSubjects(await load('index-docs-only.json'));

    expect(plan.subjects).toEqual([]);
    expect(plan.excluded).toHaveLength(2);
    expect(plan.excluded.every((entry) => entry.reason.includes('docs'))).toBe(true);
  });

  it('orders exclusions too, so one index yields one report twice running', async () => {
    const plan = toSubjects(await load('index-v5.json'), {
      excludeTags: ['animated'],
      parameters: { 'layout-stack--basic': { exclude: true } },
    });

    expect(plan.excluded.map((entry) => entry.id)).toEqual([
      'components-alert--danger',
      'components-button--docs',
      'layout-stack--basic',
    ]);
  });

  it('passes the index warnings through instead of leaving them in the reader', async () => {
    const plan = toSubjects(await load('index-future-version.json'));
    expect(plan.warnings.join(' ')).toContain('version 6');
  });
});

describe('per-story exclusion', () => {
  it('excludes a story whose parameters say so, and names the reason', async () => {
    const plan = toSubjects(await load('index-v5.json'), {
      parameters: { 'components-button--disabled': { exclude: true } },
    });

    expect(plan.subjects.map((entry) => entry.story.id)).not.toContain('components-button--disabled');
    const excluded = plan.excluded.find((entry) => entry.id === 'components-button--disabled');
    expect(excluded?.reason).toContain('parameters');
  });

  it('excludes a story by tag, which is the only per-story policy the index carries', async () => {
    // Tags survive into `index.json`; parameters do not. This is the one opt-out
    // that works without evaluating a story module.
    const plan = toSubjects(await load('index-v5.json'), { excludeTags: ['animated'] });

    expect(plan.subjects.map((entry) => entry.story.id)).not.toContain('components-alert--danger');
    expect(plan.excluded.find((entry) => entry.id === 'components-alert--danger')?.reason).toContain(
      'tag `animated`',
    );
  });

  it('leaves a story alone when its parameters mention neither exclusion nor viewport', async () => {
    const plan = toSubjects(await load('index-v5.json'), {
      parameters: { 'components-button--primary': {} },
    });

    expect(plan.subjects.map((entry) => entry.story.id)).toContain('components-button--primary');
  });
});

describe('per-story viewport', () => {
  const only = async (
    parameters: Readonly<Record<string, StoryParameters>>,
    base?: Viewport,
  ): Promise<SubjectPlan> =>
    toSubjects(await load('index-v5.json'), {
      ...(base !== undefined ? { viewport: base } : {}),
      parameters,
    });

  it('leaves the viewport absent when nothing overrode it', async () => {
    // Absent means "the run's viewport", which the harness already holds. An
    // echoed copy would invite a caller to build a second context per subject.
    const plan = toSubjects(await load('index-v5.json'), { viewport: VIEWPORT });
    expect(plan.subjects.every((entry) => entry.viewport === undefined)).toBe(true);
  });

  it('merges an override over the run viewport, keeping what it did not state', async () => {
    const plan = await only({ 'components-button--primary': { viewport: { width: 375 } } }, VIEWPORT);
    const subject = plan.subjects.find((entry) => entry.story.id === 'components-button--primary');

    expect(subject?.viewport).toEqual({
      width: 375,
      height: 800,
      deviceScaleFactor: 1,
      colorScheme: 'light',
    });
  });

  it('accepts px strings, which is how Storybook writes viewport styles', async () => {
    // `styles: { width: '320px' }` is the shape in every viewport table. Making
    // a caller reformat it puts an arithmetic mistake in the one value that
    // decides layout.
    const plan = await only(
      { 'components-button--primary': { viewport: { width: '320px', height: '568px' } } },
      VIEWPORT,
    );

    expect(plan.subjects.find((entry) => entry.story.id === 'components-button--primary')?.viewport)
      .toEqual({ width: 320, height: 568, deviceScaleFactor: 1, colorScheme: 'light' });
  });

  it('takes a complete override with no run viewport to fall back on', async () => {
    const plan = await only({
      'components-button--primary': {
        viewport: { width: 375, height: 667, deviceScaleFactor: 2, colorScheme: 'dark' },
      },
    });

    expect(plan.subjects.find((entry) => entry.story.id === 'components-button--primary')?.viewport)
      .toEqual({ width: 375, height: 667, deviceScaleFactor: 2, colorScheme: 'dark' });
  });

  it('excludes a story whose override is a relative unit rather than rendering it wrong', async () => {
    // `20em` resolves against a font size this package has never seen. Falling
    // back to the run viewport would render the story at a size it explicitly
    // rejected and report success — a wrong observation, which is worse than a
    // missing one.
    const plan = await only({ 'components-button--primary': { viewport: { width: '20em' } } }, VIEWPORT);

    expect(plan.subjects.map((entry) => entry.story.id)).not.toContain('components-button--primary');
    expect(plan.excluded.find((entry) => entry.id === 'components-button--primary')?.reason).toContain(
      'pixel lengths',
    );
  });

  it('excludes a story whose partial override cannot be completed', async () => {
    const plan = await only({ 'components-button--primary': { viewport: { width: 375 } } });

    const reason = plan.excluded.find((entry) => entry.id === 'components-button--primary')?.reason;
    expect(reason).toContain('missing height, deviceScaleFactor, colorScheme');
  });

  it('excludes a story whose override cannot be rendered at all', async () => {
    const plan = await only({ 'components-button--primary': { viewport: { width: 0 } } }, VIEWPORT);

    expect(plan.excluded.find((entry) => entry.id === 'components-button--primary')?.reason).toContain(
      'cannot be rendered',
    );
  });

  it('lets one bad parameter cost one subject, not the run', async () => {
    // A throw here would let a typo on one story decide the fate of the other
    // 239, which is the crashed-run failure ADR-0020 rules out for stories and
    // is no more acceptable for their configuration.
    const plan = await only({ 'components-button--primary': { viewport: { width: 'wide' } } }, VIEWPORT);

    expect(plan.subjects).toHaveLength(3);
    expect(plan.excluded).toHaveLength(2);
  });
});
