import { beforeAll, describe, expect, it } from 'vitest';
import { locked, opened } from '../src/gate.js';

it('runs and passes, which is all this file records', () => {
  expect(opened('a')).toBe('opened:a');
});

describe('a group whose fixture never comes up', () => {
  beforeAll(() => {
    throw new Error('the database was not there');
  });

  it('never runs, and the runner reports it skipped', () => {
    expect(locked('b')).toBe('locked:b');
  });
});
