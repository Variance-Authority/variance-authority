import { beforeAll, describe, expect, it } from 'vitest';
import { read, seed, extend } from './cache.js';

// A fresh file keeps what its `beforeAll` wrote for every test it encloses; a
// test's own write still stops at that test.
beforeAll(() => {
  seed('seeded');
});

it('reads what the file\'s beforeAll seeded', () => {
  expect(read()).toBe('seeded');
  seed('overwritten');
});

it('reads it again, whatever the test before it wrote', () => {
  expect(read()).toBe('seeded');
});

describe('a describe that seeds more', () => {
  beforeAll(() => {
    extend('+more');
  });

  it('reads what both beforeAll hooks seeded', () => {
    expect(read()).toBe('seeded+more');
    seed('overwritten');
  });

  it('reads both again, whatever the test before it wrote', () => {
    expect(read()).toBe('seeded+more');
  });
});
