import { variancePrecondition } from '@variance-authority/sense/precondition';
import { total } from '../src/cart';

// Every call below ends in a comment naming it, which is how the test that
// records this file finds the line each row should cite.

beforeEach(() => {
  variancePrecondition('fixture', { network: 'live' }); // file default
});

afterEach(() => {
  variancePrecondition('fixture', { cleaned: true }); // after each
});

describe('mocked', () => {
  beforeEach(() => {
    variancePrecondition('fixture', { network: 'mocked' }); // mocked each
  });

  it('pays', () => {
    expect(total([1, 2])).toBe(3);
  });

  it('refunds behind a flag', () => {
    variancePrecondition('fixture', { flag: 'ff-on' }); // case flag
    expect(total([])).toBe(0);
  });
});

// A sibling whose name extends the one above, and a case whose name does.
describe('mocked flow', () => {
  it('pays', () => {
    expect(total([2])).toBe(2);
  });
});

it('mocked refunds', () => {
  expect(total([3])).toBe(3);
});

describe('live', () => {
  beforeEach(() => {
    variancePrecondition('fixture', { region: 'eu' }); // live each
  });

  it('pays', () => {
    expect(total([4])).toBe(4);
  });

  it('replays a recording', () => {
    variancePrecondition('fixture', { network: 'recorded' }); // case network
    expect(total([5])).toBe(5);
  });
});

describe('contradicted', () => {
  beforeEach(() => {
    variancePrecondition('fixture', { flag: 'ff-on' }); // contradicted on
    variancePrecondition('fixture', { flag: 'ff-off' }); // contradicted off
  });

  it('pays', () => {
    expect(total([6])).toBe(6);
  });
});

// A beforeEach that says something and then fails: its case never runs, and
// the next case, in a sibling describe, never hears it.
describe('doomed', () => {
  beforeEach(() => {
    variancePrecondition('fixture', { doomed: true }); // doomed each
    throw new Error('the arrangement failed, so the case never runs');
  });

  it('never runs', () => {
    expect(total([0])).toBe(0);
  });
});

describe('after doomed', () => {
  it('pays', () => {
    expect(total([1])).toBe(1);
  });
});

it('crosses nothing', () => {
  variancePrecondition('fixture', { seeded: true }); // seeded
});
