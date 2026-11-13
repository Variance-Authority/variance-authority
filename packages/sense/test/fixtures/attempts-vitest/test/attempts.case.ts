import { afterEach, describe, expect, it } from 'vitest';
import { total } from '../src/cart.js';

// Every way a first attempt ends without its body throwing, each followed by a
// second attempt. The runner timed each of them; only it knows how they ended.
const entered: Record<string, number> = {};
const attempt = (name: string): number => (entered[name] = (entered[name] ?? 0) + 1);

it('answers late and then passes', { retry: 1, timeout: 100 }, async () => {
  if (attempt('late') === 1) await new Promise((settle) => setTimeout(settle, 300));
  expect(total([1])).toBe(1);
});

it('never answers and then passes', { retry: 1, timeout: 100 }, async () => {
  if (attempt('never') === 1) await new Promise(() => {});
  expect(total([1])).toBe(1);
});

it('fails softly and then passes', { retry: 1 }, () => {
  expect.soft(total([attempt('soft')])).toBe(2); // soft
});

describe('hooked', () => {
  afterEach(() => {
    if (attempt('hook') === 1) throw new Error('afterEach failed once');
  });
  it('fails in afterEach and then passes', { retry: 1 }, () => {
    expect(total([1])).toBe(1);
  });
});

it('fails and then skips', { retry: 1 }, (context) => {
  if (attempt('skip') === 2) context.skip();
  expect(total([1])).toBe(5);
});

it('fails twice', { retry: 1 }, () => {
  expect(total([attempt('twice')])).toBe(99);
});

it('runs once', () => {
  expect(total([1])).toBe(1);
});

it('waits for the late answer', async () => {
  await new Promise((settle) => setTimeout(settle, 400));
});
