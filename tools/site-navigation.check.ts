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

  it('exposes complete sections on indexes and their articles', () => {
    for (const path of ['/docs/theory', '/docs/tests', '/docs/reasoning']) {
      const context = navigation.navigationContext(path)!;
      expect(context.href).toBe('/docs/theory');
      expect(context.sections.flatMap(({ items }) => items.map(({ href }) => href))).toEqual(
        navigation.documentationIndex('/docs/theory')!.sections.flatMap(({ items }) => items.map(({ href }) => href)),
      );
    }
    const questions = navigation.navigationContext('/docs')!;
    expect(questions.sections.flatMap(({ items }) => items.map(({ href }) => href))).toEqual(expect.arrayContaining([
      '/docs/test-an-edit', '/docs/flakiness', '/docs/orientation',
    ]));
    const reference = navigation.navigationContext('/reference/packages/core')!;
    expect(reference.href).toBe('/docs/reference');
    expect(reference.sections.flatMap(({ items }) => items.map(({ href }) => href))).toContain('/docs/framework-reference');
    for (const path of ['/docs', '/docs/theory', '/docs/all']) {
      expect(navigation.navigationNeighbors(path)).toEqual({});
    }
  });

  it('retains a selected section for a cross-listed page and declines an unrelated one', () => {
    expect(navigation.navigationContext('/docs/changes-before-and-beyond', '/docs/theory')?.href).toBe('/docs/theory');
    expect(navigation.navigationContext('/docs/changes-before-and-beyond')?.href).toBe('/docs');
    expect(navigation.navigationContext('/docs/test-an-edit', '/docs/theory')?.href).toBe('/docs');
  });

  it('gives every published page a complete top-level context', () => {
    for (const item of navigation.NAVIGATION_ITEMS) {
      const context = navigation.navigationContext(item.href);
      expect(context, item.href).toBeDefined();
      if (!item.unlisted) {
        expect(context?.sections.flatMap(({ items }) => items.map(({ href }) => href)), item.href).toContain(item.href);
      }
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
