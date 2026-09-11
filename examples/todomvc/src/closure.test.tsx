// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { componentInstances, type ComponentInstance } from '@variance-authority/core/attribute';
import type { SemanticSnapshot, Viewport } from '@variance-authority/core/format';
import { normalize } from '@variance-authority/core/rules';
import { collect } from '@variance-authority/dom';
import { portalContentOf, provenanceOf } from '@variance-authority/react';
import { MUTATIONS, type Mutation, type MutationId } from './mutations.js';
import { renderStory } from './render.js';
import { STORIES } from './stories.js';

const VIEWPORT: Viewport = { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' };

function snapshotOf(storyId: string, mutation?: Mutation): SemanticSnapshot {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  const container = document.createElement('div');
  document.body.appendChild(container);
  try {
    renderStory(container, storyId, mutation ? { mutation } : {});
    return normalize(
      collect(container, {
        subject: { id: storyId, kind: 'story' },
        viewport: VIEWPORT,
        engine: 'jsdom@closure',
        fonts: ['system/400/normal/closure'],
        provenanceOf,
        portalsOf: portalContentOf,
      }),
    );
  } finally {
    container.remove();
  }
}

const key = (instance: ComponentInstance): string => `${instance.component} ${instance.path}`;

function suite(mutation?: Mutation): Map<string, ComponentInstance> {
  const rows = new Map<string, ComponentInstance>();
  for (const story of STORIES) {
    for (const instance of componentInstances(snapshotOf(story.id, mutation))) {
      rows.set(`${story.id} ${key(instance)}`, instance);
    }
  }
  return rows;
}

function movedIn(mutation: Mutation): readonly string[] {
  const before = suite();
  const after = suite(mutation);

  const moved = new Set<string>();
  for (const [at, instance] of after) {
    const was = before.get(at);
    if (was === undefined || was.rendering !== instance.rendering) moved.add(instance.component);
  }
  for (const [at, instance] of before) {
    if (!after.has(at)) moved.add(instance.component);
  }
  return [...moved].sort();
}

function mutationById(id: MutationId): Mutation {
  const found = MUTATIONS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no such mutation: ${id}`);
  return found;
}

/**
 * One component changed, and the question is whether anything else did.
 *
 * The claim a design system has to be able to make about its own change: the
 * border radius moved on `Button`, so `Button` moved and *nothing else did*. It
 * is a claim about the boundary rule, not about the edit — a component's hash
 * covers its own nodes and represents each child boundary as a placeholder
 * (ADR-0018), so a leaf that repaints must not reach any of the nine components
 * standing above it in this suite.
 *
 * Measured against the whole suite rather than one story, because the failure
 * mode is a *containment* failure and it shows up wherever the component is
 * nested deepest.
 */
describe('a change to one design-system component reaches exactly that component', () => {
  it('moves Button, and no ancestor of any Button', () => {
    expect(movedIn(mutationById('button-padding'))).toEqual(['Button']);
  });

  it('moves the components that read a token, and stops there', () => {
    // The other direction: a foundation edit is *supposed* to cross components,
    // and the answer is the set that resolves through the token rather than
    // everything on every page that contains one. Five of the twelve have a
    // border radius; the seven that do not are unmoved, including the five that
    // enclose the ones that did.
    expect(movedIn(mutationById('token-radius'))).toEqual([
      'Button',
      'Card',
      'Chip',
      'TextField',
      'Toggle',
    ]);
  });
});
