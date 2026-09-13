// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { retainStyles } from './styles.js';

function insert(text: string): HTMLStyleElement {
  const element = document.createElement('style');
  element.textContent = text;
  document.head.appendChild(element);
  return element;
}

describe('retainStyles', () => {
  it('puts back a sheet the suite removed before the capture read it', () => {
    const retention = retainStyles(document);
    const element = insert('.a { color: red }');

    element.remove();
    expect(document.styleSheets.length).toBe(0);

    const undo = retention.restore();
    expect(document.styleSheets.length).toBe(1);
    expect(document.styleSheets[0]!.cssRules.length).toBe(1);

    undo();
    retention.stop();
    expect(document.styleSheets.length).toBe(0);
  });

  it('leaves a sheet that was never removed exactly once in the page', () => {
    const retention = retainStyles(document);
    const element = insert('.b { color: blue }');

    const undo = retention.restore();
    expect(document.querySelectorAll('style').length).toBe(1);
    undo();
    expect(document.querySelectorAll('style').length).toBe(1);

    element.remove();
    retention.stop();
  });

  it('restores in insertion order, because that is cascade order', () => {
    const retention = retainStyles(document);
    const first = insert('.c { color: red }');
    const second = insert('.c { color: blue }');
    first.remove();
    second.remove();

    const undo = retention.restore();
    const texts = Array.from(document.querySelectorAll('style')).map((s) => s.textContent);
    expect(texts).toEqual(['.c { color: red }', '.c { color: blue }']);

    undo();
    retention.stop();
  });

  it('retains nothing rather than failing where nothing observes', () => {
    const retention = retainStyles({ defaultView: null } as unknown as Document);
    expect(retention.restore()()).toBeUndefined();
    expect(retention.stop()).toBeUndefined();
  });
});
