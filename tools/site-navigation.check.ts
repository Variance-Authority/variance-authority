import { describe, expect, it } from 'vitest';
import * as navigation from '../site/app/navigation';
import { PRODUCT_DOCUMENTS } from '../site/app/content/product-docs';
import { routedDocument } from '../site/app/content/routed-docs';

const paths = navigation.NAVIGATION_ITEMS.map(({ href }) => href);

describe('the public documentation catalogue', () => {
  it('publishes each path once', () => {
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('preserves names whose meaning is wider than an integration or use case', () => {
    expect(navigation.navigationItem('/docs/changes-before-and-beyond')?.label).toBe('Changes before and beyond');
    expect(navigation.navigationItem('/agents/interrogate')?.label).toBe('Interrogate a test where it stands');
    expect(navigation.navigationItem('/docs/sharing')?.label).toBe('Share evidence across systems');
  });

  it('keeps pagination inside a question and omits alternative integrations', () => {
    const current = navigation.navigationItem('/docs/test-an-edit')!;
    const neighbours = navigation.navigationNeighbors(current.href);
    for (const neighbour of [neighbours.previous, neighbours.next]) {
      expect(neighbour?.cluster).toBe(current.cluster);
    }
    expect(navigation.navigationNeighbors('/start/playwright')).toEqual({});
  });

  it('resolves the source behind every existing article path', () => {
    for (const { href: path } of navigation.NAVIGATION_ITEMS.filter((item) => !item.unlisted && item.href !== '/reference/packages')) {
      expect(routedDocument(path), path).toBeDefined();
    }
  });
});

describe('documentation entry paths', () => {
  it('publishes every imported public document, including home-linked guides', () => {
    const sources = new Set(paths.flatMap((path) => {
      const document = routedDocument(path);
      return document ? [document.sourcePath] : [];
    }));
    expect([...sources].sort()).toEqual(PRODUCT_DOCUMENTS.map(({ sourcePath }) => sourcePath).sort());
  });

  it('makes theory, reference, comparisons and the full index direct destinations', () => {
    expect(paths).toEqual(expect.arrayContaining([
      '/docs/theory', '/docs/reference', '/docs/comparisons', '/docs/all',
    ]));
  });

  it('does not present the whole catalogue beside an article or the home', () => {
    const local = navigation.navigationContext('/docs/test-an-edit');
    expect(local?.items.map(({ href }) => href)).toEqual(expect.arrayContaining([
      '/docs/test-an-edit', '/docs/changes-before-and-beyond',
    ]));
    expect(local?.items.some(({ href }) => href === '/docs/flakiness')).toBe(false);
    expect(navigation.navigationContext('/docs')).toBeUndefined();
    expect(navigation.navigationContext('/docs/theory')).toBeUndefined();
    expect(navigation.navigationContext('/reference/packages/core')?.items.some(({ href }) => href === '/reference/packages')).toBe(true);
    for (const path of ['/docs', '/docs/theory', '/docs/all']) {
      expect(navigation.navigationNeighbors(path)).toEqual({});
    }
  });

  it('makes theory independently browsable, including relevant names used by guides', () => {
    const theory = navigation.documentationIndex('/docs/theory');
    const names = theory?.sections.flatMap(({ items }) => items.map(({ label }) => label));
    expect(names).toEqual(expect.arrayContaining([
      'On testing', 'On dependencies', 'Changes before and beyond',
    ]));
    expect(names).not.toContain('Compare visual review tools');
  });
});
