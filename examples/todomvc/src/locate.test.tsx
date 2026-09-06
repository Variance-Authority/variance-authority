// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  composeSubjects,
  componentInstances,
  lexiconOf,
  normalize,
  type LexiconField,
  type SemanticSnapshot,
  type SubjectComposition,
  type Viewport,
} from '@variance-authority/core';
import { collect } from '@variance-authority/dom';
import { locateSubjects } from '@variance-authority/mcp';
import { portalContentOf, provenanceOf } from '@variance-authority/react';
import type { RunReport } from '@variance-authority/report';
import { renderStory } from './render.js';
import { buildSourceIndex } from './source-index.js';
import { STORIES } from './stories.js';

/**
 * Finding a subject from a description, measured on a real suite.
 *
 * Twenty questions an agent asks on arrival, each with the subject a person
 * would open for it, and five that this suite has no subject for. The tool is
 * held to two counts: how often the person's subject is the first hit, and how
 * often a question with no answer came back with none rather than with a wrong
 * one. Both are asserted rather than described because they are the claim
 * [`composition.md`](../../../docs/composition.md) makes for `variance_locate`.
 *
 * The control is printed here so nobody mistakes the numbers for a gain on
 * this suite: fifteen ids fit in one `variance_summary`, and an agent that can
 * read them finds every one of these by scanning. The tool earns its place on
 * a suite whose ids do not fit in one answer; this file shows only that on a
 * suite where they do, it agrees with the reader.
 */

const VIEWPORT: Viewport = { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' };

function snapshotOf(storyId: string): SemanticSnapshot {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  const container = document.createElement('div');
  document.body.appendChild(container);

  try {
    renderStory(container, storyId);

    return normalize(
      collect(container, {
        subject: { id: storyId, kind: 'story' },
        viewport: VIEWPORT,
        engine: 'jsdom@locate',
        fonts: ['system/400/normal/locate'],
        provenanceOf,
        portalsOf: portalContentOf,
      }),
    );
  } finally {
    container.remove();
  }
}

const SUITE: readonly SubjectComposition[] = STORIES.map((story) => {
  const snapshot = snapshotOf(story.id);
  return { subject: story.id, instances: componentInstances(snapshot), snapshot };
});

/** The lexicon the way `variance run` writes it: examples from the census, files from the index. */
function lexiconReport(): NonNullable<RunReport['lexicon']> {
  const examples = new Map<string, string[]>();
  for (const entry of composeSubjects(SUITE).components) {
    for (const subject of entry.examples) {
      const held = examples.get(subject);
      if (held === undefined) examples.set(subject, [entry.component]);
      else held.push(entry.component);
    }
  }
  const declaredIn = new Map(
    Object.entries(buildSourceIndex()).map(([name, sites]) => [name, sites.map((site) => site.file)]),
  );
  const fields: LexiconField[] = ['example', 'names', 'text', 'components', 'createdBy', 'files', 'roles', 'tokens'];
  return { version: 1, fields, subjects: lexiconOf(SUITE, { examples, declaredIn }) };
}

const REPORT: RunReport = {
  runVersion: 1,
  at: '2026-09-06T00:00:00.000Z',
  identity: {
    renderer: 'jsdom',
    engine: 'jsdom@locate',
    platform: 'any',
    deviceScaleFactor: 1,
    fonts: [],
  },
  retention: 'durable',
  observations: STORIES.map((story) => ({
    subject: story.id,
    verdict: 'unchanged',
    because: 'same',
    changedPixels: 0,
    regions: [],
  })),
  lexicon: lexiconReport(),
};

/** What an agent types, and the subject a person opens for it. */
const ANSWERED: readonly (readonly [query: string, subject: string])[] = [
  ['footer', 'page/footer--counts'],
  ['the danger button', 'ds/button--danger'],
  ['clear completed', 'page/footer--counts'],
  ['toggle', 'ds/toggle--states'],
  ['empty list', 'page/todos--empty'],
  ['what needs doing', 'ds/field--empty'],
  ['heading and caption', 'ds/text--scale'],
  ['card', 'ds/card--basic'],
  ['chips', 'ds/chip--group'],
  ['done item', 'page/item--done'],
  ['drafting', 'page/todos--drafting'],
  ['active filter', 'page/todos--active-filter'],
  ['completed filter', 'page/todos--completed-filter'],
  ['populated todos', 'page/todos--populated'],
  ['text field', 'ds/field--empty'],
  ['save', 'ds/button--default'],
  ['TodoFooter', 'page/footer--counts'],
  ['TodoApp', 'page/todos--empty'],
  ['checkbox', 'ds/toggle--states'],
  ['components.tsx', 'ds/button--danger'],
];

/** Questions this suite holds nothing for; the right answer is no hit. */
const UNANSWERABLE: readonly string[] = [
  'dark mode',
  'sign in',
  'sidebar navigation',
  'delete confirmation',
  'search box',
];

function rankOf(query: string, subject: string): number {
  return locateSubjects(REPORT, query).hits.findIndex((hit) => hit.subject === subject);
}

describe('variance_locate on todomvc', () => {
  const ranks = ANSWERED.map(([query, subject]) => [query, subject, rankOf(query, subject)] as const);
  const refused = UNANSWERABLE.map((query) => [query, locateSubjects(REPORT, query).hits.length] as const);

  it('puts the subject a person would open first on nineteen of twenty', () => {
    // The one it does not: `clear completed` names the footer's button, and the
    // page whose id holds `completed` outranks the footer on that word. The
    // footer is second, and a wrong first hit here costs one more call.
    expect(ranks.filter(([, , rank]) => rank !== 0)).toEqual([
      ['clear completed', 'page/footer--counts', 1],
    ]);
    expect(locateSubjects(REPORT, 'clear completed').hits[0]?.subject).toBe('page/todos--completed-filter');
  });

  it('holds it within the first three on every question', () => {
    expect(ranks.filter(([, , rank]) => rank < 0 || rank > 2)).toEqual([]);
  });

  it('answers nothing when the suite holds nothing, never a wrong subject', () => {
    expect(refused.filter(([, hits]) => hits !== 0)).toEqual([]);
    expect(refused).toHaveLength(5);
  });

  it('says which field each hit came from, so the order is checkable', () => {
    const located = locateSubjects(REPORT, 'footer');
    const first = located.hits[0];

    expect(first?.subject).toBe('page/footer--counts');
    expect(first?.matches.map((match) => match.field)).toEqual(['id', 'example', 'components', 'createdBy']);
  });
});
