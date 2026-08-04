// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { collectStories, collectStory } from './preview.js';
import { BASE, READY, TIMING, fakePage, fakePreview, type FakePreview } from './preview-fake.js';

/**
 * A marker the subject attaches, and the fallback it must never take.
 *
 * Its own suite because `readySelector` is a property to defend rather than a
 * behaviour to check: it is worth configuring only if a marker that never
 * arrives is a timeout. Every test below aims at that one sentence, or at the
 * ladder of evidence it sits on top of — so they are read together, and a change
 * that quietly re-introduced a fallback would have to survive all of them at
 * once. The fake, and what a fake can prove, is in `preview-fake.ts`.
 */

let preview: FakePreview | null = null;

afterEach(() => {
  preview?.dispose();
  preview = null;
});

/**
 * The rung above Storybook's own signal.
 *
 * `storyRendered` is the framework's claim that the story function returned; the
 * marker is the subject's claim that it has finished. The fake keeps the two
 * twelve milliseconds apart on purpose, because that gap is the whole reason a
 * project would configure a marker at all.
 */
describe('a subject that declares its own readiness', () => {
  it('reports readiness `declared` when the subject attaches the marker', async () => {
    // Guards against the marker being accepted but filed under the framework's
    // signal: a caller that cannot see `declared` cannot tell the strongest
    // evidence from the second strongest, and the rung stops being worth having.
    preview = fakePreview({ 'a--one': 'declares', 'a--two': 'declares' });
    const page = fakePage(preview);
    const attachedWhenObserved: boolean[] = [];

    const outcomes = await collectStories(page, ['a--one', 'a--two'], {
      baseUrl: BASE,
      ...TIMING,
      readySelector: READY,
      // Guards against finishing at `storyRendered` and waiting for the marker
      // never: at 1ms the marker is not there yet, so an early finish is visible
      // here as a capture taken before the subject had settled.
      observe: (): void => {
        attachedWhenObserved.push(document.querySelector(READY) !== null);
      },
    });

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rendered', 'rendered']);
    expect(outcomes.map((outcome) => outcome.readiness)).toEqual(['declared', 'declared']);
    expect(attachedWhenObserved).toEqual([true, true]);
  });

  it('times out rather than falling back when a configured marker never appears', async () => {
    // The property this whole feature stands on. Both weaker paths are covered:
    // `a--one` is the story the URL already selected, whose markup goes quiet
    // immediately, and `a--two` is switched over the channel and does emit
    // `storyRendered`. Either one answered with `rendered` would mean a project
    // that asked to be asked was quietly answered with a guess — and it would
    // believe it held the strong signal while holding the weak one.
    preview = fakePreview({ 'a--one': 'silent', 'a--two': 'renders' });
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], {
      baseUrl: BASE,
      ...TIMING,
      readySelector: READY,
    });

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['timeout', 'timeout']);
    expect(outcomes.map((outcome) => outcome.readiness)).toEqual(['none', 'none']);
    for (const outcome of outcomes) {
      expect(outcome.readiness).not.toBe('markup-quiescent');
      expect(outcome.readiness).not.toBe('storyRendered');
      expect(outcome.readiness).not.toBe('already-rendered');
    }
  });

  it('names the marker that never appeared, so the contract is fixable', async () => {
    // A bare `timeout` sends someone to read the component; naming the selector
    // sends them to the one line of application code that was supposed to
    // attach it.
    preview = fakePreview({ 'a--one': 'silent' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', {
      baseUrl: BASE,
      ...TIMING,
      readySelector: READY,
    });

    expect(outcome.status).toBe('timeout');
    expect(outcome.error?.from).toBe('story');
    expect(outcome.error?.message).toContain(READY);
  });

  it('changes nothing at all when no marker is configured', async () => {
    // The absent option must be genuinely absent, not a default in disguise: a
    // marker nobody agreed to attach would turn every existing run into a suite
    // of timeouts.
    preview = fakePreview({ 'a--one': 'silent', 'a--two': 'renders' });
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rendered', 'rendered']);
    expect(outcomes.map((outcome) => outcome.readiness)).toEqual([
      'already-rendered',
      'storyRendered',
    ]);
    expect(outcomes.flatMap((outcome) => outcome.warnings)).toEqual([]);
    expect(page.navigations).toHaveLength(1);
  });

  it('accepts the marker alone when there is no channel to hear Storybook on', async () => {
    // Without a channel there is no framework signal to wait for, and the
    // fallback would otherwise be markup quiescence — which is exactly what the
    // marker exists to replace.
    preview = fakePreview({ 'a--one': 'declares' }, false);
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', {
      baseUrl: BASE,
      ...TIMING,
      readySelector: READY,
    });

    expect(outcome.status).toBe('rendered');
    expect(outcome.readiness).toBe('declared');
    expect(outcome.channel).toBe(false);
  });

  it('says in the warnings that the subject declared readiness, not the framework', async () => {
    // `declared` and `storyRendered` are one word apart in a result and a world
    // apart in what they claim. Anyone reading the outcome should not have to
    // know the union's ordering to see which happened.
    preview = fakePreview({ 'a--one': 'declares' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', {
      baseUrl: BASE,
      ...TIMING,
      readySelector: READY,
    });

    expect(outcome.warnings.join(' ')).toContain(READY);
    expect(outcome.warnings.join(' ')).toContain('the application saying it has settled');
  });
});
