import { variancePrecondition } from '@variance-authority/sense/precondition';
import { total } from '../src/cart';

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

it('crosses nothing', () => {
  variancePrecondition('seeded'); // seeded
});
