/**
 * One small suite, built twice over: as a graph, and as something that moved.
 *
 * `composition.test.ts` proves the fold and `movement.test.ts` proves the ladder
 * that reads it, and they need the same three subjects to do it. A chip in its
 * own story and the same chip in a page is the smallest arrangement in which an
 * echo, a divergence and a control group are all available at once, so it is
 * described once here rather than diverging in two files.
 */

import type { ComponentInstance } from './instances.js';
import type { SubjectComposition } from './composition.js';

export function instance(over: Partial<ComponentInstance> & { component: string }): ComponentInstance {
  return {
    path: '0',
    depth: 1,
    rendering: 'v1:r',
    structure: 'v1:s',
    semantics: 'v1:a',
    text: 'v1:t',
    style: 'v1:y',
    renders: [],
    nodes: 1,
    tokens: [],
    ...over,
  };
}

/** A chip, rendered the same way, with the same inputs. */
export const chip = (path: string, within: string, over: Partial<ComponentInstance> = {}) =>
  instance({
    component: 'Chip',
    path,
    within,
    depth: 2,
    props: 'v1:chip',
    rendering: 'v1:chip-done',
    ...over,
  });

export const SUITE: readonly SubjectComposition[] = [
  {
    subject: 'story:ds-chip--done',
    instances: [
      instance({ component: 'Story', path: '0', depth: 0, renders: ['Chip'] }),
      chip('0/0', 'Story'),
    ],
  },
  {
    subject: 'story:page--default',
    instances: [
      instance({ component: 'App', path: '0', depth: 0, renders: ['Footer'] }),
      instance({ component: 'Footer', path: '0/1', depth: 1, renders: ['Chip', 'Chip'] }),
      chip('0/1/0', 'Footer', { props: 'v1:chip-all', rendering: 'v1:chip-all' }),
      chip('0/1/1', 'Footer'),
    ],
  },
];
