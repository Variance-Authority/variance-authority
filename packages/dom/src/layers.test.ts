import { describe, expect, it } from 'vitest';
import { LayerOrder, inLayers } from './layers.js';

describe('writing rules back into their cascade layers', () => {
  it('declares the layers the rules use once, in the page order, ahead of every rule', () => {
    const css = inLayers(
      [
        { text: 'h2 {font-size:inherit}', layer: 'base' },
        { text: '.card {display:block}', layer: 'components.cards' },
        { text: ':where(.doc h2) {font-size:40px}' },
      ],
      ['theme', 'base', 'components', 'components.cards', 'utilities'],
    );

    expect(css).toBe(
      [
        '@layer base, components, components.cards;',
        '@layer base {',
        'h2 {font-size:inherit}',
        '}',
        '@layer components.cards {',
        '.card {display:block}',
        '}',
        ':where(.doc h2) {font-size:40px}',
      ].join('\n'),
    );
  });

  it('keeps a run of rules in one layer in one block, in document order', () => {
    const css = inLayers(
      [
        { text: 'a {color:red}', layer: 'base' },
        { text: 'b {color:red}', layer: 'base' },
        { text: 'c {color:red}' },
        { text: 'd {color:red}', layer: 'base' },
      ],
      ['base'],
    );

    expect(css).toBe(
      ['@layer base;', '@layer base {', 'a {color:red}', 'b {color:red}', '}', 'c {color:red}', '@layer base {', 'd {color:red}', '}'].join('\n'),
    );
  });

  it('writes no layer at all for rules that sat in none', () => {
    expect(inLayers([{ text: 'a {color:red}' }], ['base'])).toBe('a {color:red}');
  });
});

describe('the order layers are declared in', () => {
  it('puts a parent ahead of the layer nested in it, each the first time it is seen', () => {
    const order = new LayerOrder();
    order.declare('components.cards');
    order.declare('base');
    order.declare('components');

    expect(order.names).toEqual(['components', 'components.cards', 'base']);
  });

  it('names each anonymous layer apart, under the layer it is nested in', () => {
    const order = new LayerOrder();
    expect(order.anonymousWithin(undefined)).not.toBe(order.anonymousWithin(undefined));
    expect(order.anonymousWithin('base').startsWith('base.')).toBe(true);
  });
});
