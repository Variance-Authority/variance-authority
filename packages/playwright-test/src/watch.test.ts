// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { takeWatch, unwatch, watch } from './watch.js';

/**
 * The page half of the in-place guard, read where the page agent runs it: what
 * the subject did between `watch` and `takeWatch`. The Chromium pins in
 * `watch.chromium.test.ts` drive the same code through a real capture.
 */

let cart: HTMLElement;

beforeEach(() => {
  document.body.innerHTML =
    '<main><section id="cart" data-state="idle"><h1>Cart</h1><p>Empty</p>' +
    '<aside data-variance-ignore><time>12:00</time></aside></section></main>';
  cart = document.getElementById('cart')!;
});

afterEach(() => unwatch());

const text = (): Text => cart.querySelector('p')!.firstChild as Text;

describe('takeWatch', () => {
  it('is absent when nothing was watching, which is not the same as nothing changing', () => {
    expect(takeWatch()).toBeUndefined();
    watch(cart);
    expect(takeWatch()).toEqual([]);
    // Taking the watch stops it.
    expect(takeWatch()).toBeUndefined();
  });

  it('is absent after unwatch, and records nothing after it', () => {
    watch(cart);
    unwatch();
    text().data = 'One item';
    expect(takeWatch()).toBeUndefined();
  });

  it('names a text changed and changed back', () => {
    watch(cart);
    text().data = 'One item';
    text().data = 'Empty';
    expect(takeWatch()).toEqual(['the text in `section#cart > p`']);
  });

  it('names an attribute set to another value and back', () => {
    watch(cart);
    cart.setAttribute('data-state', 'busy');
    cart.setAttribute('data-state', 'idle');
    expect(takeWatch()).toEqual(['the `data-state` attribute of `section#cart`']);
  });

  it('names nothing for writes of the value already held, once or many times', () => {
    watch(cart);
    for (let tick = 0; tick < 3; tick += 1) {
      cart.setAttribute('data-state', 'idle');
      text().data = 'Empty';
    }
    expect(takeWatch()).toEqual([]);
  });

  it('names children added or removed', () => {
    watch(cart);
    cart.querySelector('h1')!.append(document.createElement('span'));
    cart.querySelector('p')!.remove();
    expect(takeWatch()).toEqual(['the children of `section#cart > h1`', 'the children of `section#cart`']);
  });

  it('names nothing changed inside a region the page marks ignored', () => {
    watch(cart);
    const time = cart.querySelector('time')!;
    time.textContent = '12:01';
    time.setAttribute('datetime', '12:01');
    cart.querySelector('aside')!.append(document.createElement('time'));
    expect(takeWatch()).toEqual([]);
  });

  it('names nothing for an ignored region added to the subject', () => {
    watch(cart);
    const banner = document.createElement('div');
    banner.setAttribute('data-variance-ignore', '');
    cart.append(banner);
    expect(takeWatch()).toEqual([]);
  });

  it('watches one root at a time: a new watch drops the one before it', () => {
    const heading = cart.querySelector('h1')!;
    watch(cart);
    watch(heading);
    cart.setAttribute('data-state', 'busy');
    expect(takeWatch()).toEqual([]);
  });
});
