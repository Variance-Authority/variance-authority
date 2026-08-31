import { describe, expect, it } from 'vitest';
import type { BuildDetail, SubjectView } from '../review-types.js';
import { foreseenBy, unforeseen } from './foreseen.js';

/**
 * The prediction, and the four things that can become of it.
 *
 * Every failure guarded here is a build overstating what it knows. A reached
 * subject an ignore rule forgave counted as one the edit missed; a build with no
 * diff reporting that nothing escaped it; a subject with no baseline filed under
 * either. Each of those reads as a finding, and all three are the page inventing
 * one out of a shape it did not measure.
 */

const BUTTON = 'app/src/components/ui/button.tsx';
const NAV = 'app/src/components/MainNav.tsx';

function subject(name: string, verdict: SubjectView['verdict']): SubjectView {
  return { subject: name, verdict, because: '', changedPixels: 0, regions: [] } as SubjectView;
}

function build(over: Partial<BuildDetail> = {}): BuildDetail {
  return {
    project: 'snkr-shop',
    build: '10',
    commit: 'a'.repeat(40),
    at: '2026-08-31T00:00:00.000Z',
    identity: { engine: 'chromium' } as BuildDetail['identity'],
    retention: 'durable',
    verdicts: { changed: 1 } as BuildDetail['verdicts'],
    decided: 0,
    pending: 1,
    coverage: { stated: true, failed: 0, excluded: 0 },
    subjects: [
      subject('story:button--primary', 'changed'),
      subject('story:button--outline', 'unchanged'),
      subject('story:main-nav--empty', 'ignored'),
      subject('story:main-nav--filled', 'new'),
    ],
    notObserved: [],
    causes: [],
    variations: [],
    declarations: { ignores: null, sensitivities: null },
    movements: [],
    composition: null,
    reach: {
      against: 'HEAD~1',
      changed: [BUTTON, NAV],
      components: [
        { component: 'Button', trail: [BUTTON, 'Button'] },
        { component: 'MainNav', trail: [NAV, 'MainNav'] },
      ],
      subjects: {
        'story:button--primary': { reached: true, through: ['Button'], because: '' },
        'story:button--outline': { reached: true, through: ['Button'], because: '' },
        'story:main-nav--empty': { reached: true, through: ['MainNav'], because: '' },
        'story:main-nav--filled': { reached: true, through: ['MainNav'], because: '' },
      },
    },
    ...over,
  };
}

describe('what the diff implied, against what moved', () => {
  it('counts the subjects a changed file reaches and the ones that moved', () => {
    expect(foreseenBy(build(), BUTTON)).toEqual({
      reached: 2,
      moved: 1,
      still: ['story:button--outline'],
      excluded: [],
      uncompared: [],
    });
  });

  it('keeps a subject an ignore rule forgave out of the ones that did not move', () => {
    // `main-nav--empty` moved by three hundred pixels and every one of them fell
    // inside a declared ignore. Filed under `still` it would tell a reviewer the
    // edit missed the component it was written for.
    const seen = foreseenBy(build(), NAV);

    expect(seen?.still).toEqual([]);
    expect(seen?.excluded).toEqual(['story:main-nav--empty']);
  });

  it('files a subject with no baseline under neither', () => {
    expect(foreseenBy(build(), NAV)?.uncompared).toEqual(['story:main-nav--filled']);
  });

  it('answers nothing for a file the reach walk never started from', () => {
    // Not zero. A file with no components in the reach set made no prediction,
    // and `0 reached` is a prediction that reached nothing.
    expect(foreseenBy(build(), 'app/src/components/Untouched.tsx')).toBeNull();
  });

  it('answers nothing when the run attributed no diff', () => {
    const blind = build({
      reach: { against: 'HEAD~1', changed: [BUTTON], components: [], whole: 'no diff was read' },
    });

    expect(foreseenBy(blind, BUTTON)).toBeNull();
    expect(unforeseen(blind)).toBeNull();
  });

  it('names the changed subjects the commit does not reach', () => {
    const loose = build({
      subjects: [...build().subjects, subject('route/checkout@1280', 'changed')],
    });

    expect(unforeseen(loose)).toEqual(['route/checkout@1280']);
  });

  it('answers an empty list when the commit reaches everything that moved', () => {
    // Which is a claim, not an absence: nothing escaped what you edited.
    expect(unforeseen(build())).toEqual([]);
  });

  it('does not count a subject the commit reaches through some other file', () => {
    expect(foreseenBy(build(), BUTTON)?.reached).toBe(2);
    expect(foreseenBy(build(), NAV)?.reached).toBe(2);
  });
});
