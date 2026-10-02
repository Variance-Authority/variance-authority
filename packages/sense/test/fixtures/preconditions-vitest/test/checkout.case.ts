import { variancePrecondition } from '@variance-authority/sense/precondition';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { total } from '../src/cart.js';

// Every call below ends in a comment naming it, which is how the test that
// records this file finds the line each row should cite.

variancePrecondition('network', 'live'); // file default

afterEach(() => {
  variancePrecondition('cleaned'); // after each
});

describe('mocked', () => {
  beforeEach(() => {
    variancePrecondition('network', 'mocked'); // mocked each
  });

  it('pays', () => {
    expect(total([1, 2])).toBe(3);
  });

  it('refunds behind a flag', () => {
    variancePrecondition({ flag: 'ff-on' }); // case flag
    expect(total([])).toBe(0);
  });
});

describe('live', () => {
  variancePrecondition('region', 'eu'); // live describe

  it('pays', () => {
    expect(total([4])).toBe(4);
  });

  it('replays a recording', () => {
    variancePrecondition('network', 'recorded'); // case network
    expect(total([5])).toBe(5);
  });
});

describe('contradicted', () => {
  beforeAll(() => {
    variancePrecondition('flag', 'ff-on'); // contradicted on
    variancePrecondition('flag', 'ff-off'); // contradicted off
  });

  it('pays', () => {
    expect(total([6])).toBe(6);
  });
});

describe.concurrent('lanes', () => {
  beforeEach(async ({ task }) => {
    await new Promise((settle) => setTimeout(settle, task.name === 'left' ? 20 : 1));
    variancePrecondition('lane', task.name); // lane each
  });

  it('left', async () => {
    await new Promise((settle) => setTimeout(settle, 1));
    variancePrecondition('side', 'left'); // left side
    expect(total([7])).toBe(7);
  });

  it('right', async () => {
    await new Promise((settle) => setTimeout(settle, 20));
    variancePrecondition('side', 'right'); // right side
    expect(total([8])).toBe(8);
  });
});

let attempts = 0;
it('retries', { retry: 1 }, () => {
  attempts += 1;
  variancePrecondition('attempt', attempts); // retried
  expect(attempts).toBe(2);
});

it('crosses nothing', () => {
  variancePrecondition('seeded'); // seeded
});
