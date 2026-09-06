import type { ComponentInstance, SourceIndex, SubjectComposition } from '@variance-authority/core';
import type { CliObservationRecord } from './run-report.js';

export function instance(
  over: Partial<ComponentInstance> & { component: string },
): ComponentInstance {
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

export const button = (path: string, depth: number, over: Partial<ComponentInstance> = {}) =>
  instance({
    component: 'Button',
    path,
    depth,
    props: 'v1:danger',
    rendering: 'v1:button-danger',
    tokens: ['--va-danger'],
    renders: ['Icon'],
    ...over,
  });

export const icon = (path: string, depth: number, over: Partial<ComponentInstance> = {}) =>
  instance({
    component: 'Icon',
    path,
    depth,
    within: 'Button',
    props: 'v1:icon',
    rendering: 'v1:icon-warn',
    tokens: ['--va-warn'],
    ...over,
  });

/**
 * One story that *is* a `Button`, and two pages that each mount another one.
 *
 * Two components on purpose. `Button` renders two ways from one props digest, so
 * it is a standing contradiction and can never reach `unexplained`; `Icon`
 * renders identically everywhere, which is what a control group looks like and
 * therefore the only kind of component a shortlist entry can be made of.
 *
 * The quiet button gets a page of its own rather than sitting beside the danger
 * one, and that is not tidiness. `divergencesOf` refuses to call two renderings a
 * contradiction when they were both observed in a single subject, because one
 * boundary interrupted by a nested component is walked as two — so a fixture with
 * both renderings on one page tests the refusal rather than the rung.
 */
export const SUITE: readonly SubjectComposition[] = [
  {
    subject: 'story:ds-button--danger',
    instances: [button('0', 0), icon('0/0', 1)],
  },
  {
    subject: 'story:page--default',
    instances: [
      instance({ component: 'App', path: '0', depth: 0, renders: ['Footer'] }),
      instance({
        component: 'Footer',
        path: '0/1',
        within: 'App',
        props: 'v1:footer',
        renders: ['Button'],
      }),
      // `<Footer><Button><Icon/></Button></Footer>`: the icon *sits inside* the
      // button and was *written by* the footer, which is the ordinary shape and
      // the reason the two edges are recorded separately.
      button('0/1/0', 2, { within: 'Footer', createdBy: 'Footer' }),
      icon('0/1/0/0', 3, { createdBy: 'Footer' }),
    ],
  },
  {
    subject: 'story:page--quiet',
    instances: [
      instance({ component: 'App', path: '0', depth: 0, renders: ['Footer'] }),
      instance({
        component: 'Footer',
        path: '0/1',
        within: 'App',
        props: 'v1:footer',
        renders: ['Button'],
      }),
      button('0/1/0', 2, {
        within: 'Footer',
        createdBy: 'Footer',
        rendering: 'v1:button-quiet',
        style: 'v1:quiet',
      }),
    ],
  },
];

export function observation(
  over: Partial<CliObservationRecord> & { subject: string },
): CliObservationRecord {
  return {
    verdict: 'changed',
    because: 'pixels differ',
    changedPixels: 120,
    regions: [],
    ...over,
  };
}

/** A region that named `Button` as the root of the change. */
export const causedByButton = {
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  pixels: 100,
  component: 'Button',
  cause: true,
};

/** A region that named `Icon` as the root of the change. */
export const causedByIcon = { ...causedByButton, component: 'Icon' };

export const SOURCE: SourceIndex = {
  Button: [{ file: 'src/ds/Button.tsx', line: 12, via: 'function' }],
  Icon: [{ file: 'src/ds/Icon.tsx', line: 4, via: 'function' }],
  Footer: [{ file: 'src/Footer.tsx', line: 3, via: 'function' }],
};
