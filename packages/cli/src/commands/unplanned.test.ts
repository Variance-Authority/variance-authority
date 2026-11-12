import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDurableStore } from '@variance-authority/store/durable';
import { describe, expect, it } from 'vitest';
import { keyFor, type Collected, type PlannedSubject, type Visit } from './collector.js';
import {
  collectorOf,
  configOf,
  documentFor,
  IDENTITY,
  rasterFor,
  runWith,
  storeAnswering,
  VIEWPORT,
} from './run-fixture.js';
import type { Plan } from './run.js';
import { keptRaster } from '@variance-authority/store/keep';

/**
 * The run's one report about subjects it did not look at (ADR-0063).
 *
 * Advisory by construction: the sentence is a warning, the exit code does not
 * move, and a store that cannot answer produces prose rather than a lost run.
 * `unplanned.ts` holds why it is asked of the whole plan; these hold what the
 * run does with each of the three answers a store can give.
 */

const PLAN: Plan = {
  subjects: [
    { subject: { id: 'fixture:a', kind: 'fixture' } },
    { subject: { id: 'fixture:b', kind: 'fixture' } },
  ],
  notObserved: [],
  warnings: [],
};

const collectsBoth = collectorOf(PLAN, (subject) => ({
  ok: true,
  document: documentFor(subject.subject.id),
}));

describe('unplanned subjects', () => {
// A discovered plan reports an addition loudly and a removal not at all: the
// dropped subject is never collected, so no verdict names it, while its
// approved image stays on disk. The store is the only thing that can notice.
it('names an approved subject the plan no longer contains', async () => {
  const { report } = await runWith(configOf(), collectsBoth, {
    ...storeAnswering(null),
    async unplanned() {
      return ['fixture:gone'];
    },
  });

  expect(report.warnings?.join('\n')).toContain('fixture:gone');
});

// `unplanned` is optional because a backend behind an API with no list call
// cannot answer it, and a run that turned that into a sentence would report
// every store that cannot enumerate as a store holding nothing.
it('says nothing about held subjects when the store cannot enumerate', async () => {
  const { report } = await runWith(configOf(), collectsBoth, storeAnswering(null));

  expect(report.warnings?.join('\n') ?? '').not.toContain('did not plan');
});

// Advisory, and asked after every planned subject has already been compared.
// A directory that could not be listed is not a reason to lose the run.
it('reports a store that could not be asked, rather than ending the run', async () => {
  const { report } = await runWith(configOf(), collectsBoth, {
    ...storeAnswering(null),
    async unplanned() {
      throw new Error('EACCES');
    },
  });

  expect(report.observations).toHaveLength(2);
  expect(report.warnings?.join('\n')).toContain('could not be asked what it holds');
});
});

/**
 * A story's widths are read at its visit, so a run that does not visit it —
 * narrowed by `--subjects`, `--since` or a shard — never learns them. Its width
 * baselines are still the story's, and the plan still holds the story.
 */
describe('unplanned widths', () => {
  const STORY: PlannedSubject = {
    subject: { id: 'story:button--primary', kind: 'story' },
    title: 'Button',
    name: 'Primary',
  };
  const OTHER: PlannedSubject = {
    subject: { id: 'story:button--secondary', kind: 'story' },
    title: 'Button',
    name: 'Secondary',
  };
  const STORIES: Plan = { subjects: [STORY, OTHER], notObserved: [], warnings: [] };
  const atWidth = (width: number): PlannedSubject => ({
    ...STORY,
    subject: { ...STORY.subject, id: `${STORY.subject.id}@${width}` },
    name: `${STORY.name} @${width}`,
    viewport: { ...VIEWPORT, width },
  });

  const visiting = (widths: readonly PlannedSubject[]) => ({
    ...collectorOf(STORIES, () => ({ ok: true, document: documentFor('x') })),
    async collect(planned: PlannedSubject): Promise<Collected | Visit> {
      const subjects = planned.subject.id === STORY.subject.id ? widths : [planned];
      return {
        subjects: subjects.map((subject) => ({
          planned: subject,
          collected: { ok: true, document: documentFor(subject.subject.id) },
        })),
      };
    },
  });

  async function holding(...subjects: readonly PlannedSubject[]) {
    const root = await mkdtemp(join(tmpdir(), 'va-unplanned-widths-'));
    const store = createDurableStore(root);
    for (const subject of subjects) {
      await store.put(keyFor(subject), await keptRaster(rasterFor(documentFor(subject.subject.id), IDENTITY)));
    }
    return store;
  }

  it('reads a visited story`s width baseline as planned', async () => {
    const { report } = await runWith(configOf(), visiting([atWidth(375)]), await holding(atWidth(375)));

    expect(report.warnings?.join('\n') ?? '').not.toContain('did not plan');
  });

  it('reads the width baseline of a story the run skipped as planned', async () => {
    const { report } = await runWith(configOf(), visiting([atWidth(375)]), await holding(atWidth(375)), {
      subjects: OTHER.subject.id,
    });

    expect(report.notObserved?.map((entry) => entry.subject)).toContain(STORY.subject.id);
    expect(report.warnings?.join('\n') ?? '').not.toContain('did not plan');
  });

  // Visited, the story said which widths it declares now; a width it dropped
  // left the suite, which is what this report exists to say.
  it('names the baseline of a width a visited story no longer declares', async () => {
    const { report } = await runWith(
      configOf(),
      visiting([atWidth(375)]),
      await holding(atWidth(375), atWidth(768)),
    );

    expect(report.warnings?.join('\n')).toContain('Button/Primary-768');
    expect(report.warnings?.join('\n')).not.toContain('Primary-375');
  });

  // A visit that read nothing learned nothing of the story's widths, whether it
  // failed or realized no subject at all: the story is as unread as a skipped one.
  it('reads the width baseline of a story whose visit read nothing as planned', async () => {
    const failing = (answer: Collected | Visit) => ({
      ...visiting([]),
      async collect(planned: PlannedSubject): Promise<Collected | Visit> {
        return planned.subject.id === STORY.subject.id ? answer : { ok: true, document: documentFor(planned.subject.id) };
      },
    });

    for (const answer of [{ ok: false, because: 'the page threw' } as const, { subjects: [] }]) {
      const { report } = await runWith(configOf(), failing(answer), await holding(atWidth(375)));

      expect(report.notObserved?.map((entry) => entry.kind)).toEqual(['failed']);
      expect(report.warnings?.join('\n') ?? '').not.toContain('did not plan');
    }
  });

  // Visited, the story said it is no subject of this run: every baseline it
  // left, at its own id and at each width, is one the suite no longer holds.
  it('names every baseline of a story that excluded itself at its visit', async () => {
    const excluding = {
      ...visiting([]),
      async collect(planned: PlannedSubject): Promise<Collected | Visit> {
        return planned.subject.id === STORY.subject.id
          ? { ok: false, excluded: true, because: '`parameters.variance.exclude` is true' }
          : { ok: true, document: documentFor(planned.subject.id) };
      },
    };

    const { report } = await runWith(configOf(), excluding, await holding(STORY, atWidth(375)));

    expect(report.notObserved?.map((entry) => entry.kind)).toEqual(['excluded']);
    expect(report.warnings?.join('\n')).toContain('holds 2 approved baselines this run did not plan');
  });

  // Read, but with its parameters unknown: the story was read at the run's
  // viewport, and which widths it declares is as unknown as for a skipped one.
  it('reads the width baseline of a story read without its parameters as planned', async () => {
    const unread = {
      ...visiting([]),
      async collect(planned: PlannedSubject): Promise<Collected | Visit> {
        return {
          subjects: [{ planned, collected: { ok: true, document: documentFor(planned.subject.id) } }],
          ...(planned.subject.id === STORY.subject.id
            ? { warnings: ['the parameters of story `button--primary` were not read'], incomplete: true }
            : {}),
        };
      },
    };

    const { report } = await runWith(configOf(), unread, await holding(atWidth(375)));

    expect(report.observations?.map((entry) => entry.subject)).toContain(STORY.subject.id);
    expect(report.warnings?.join('\n') ?? '').not.toContain('did not plan');
  });
});
