import { add, double } from '../src/math';

jest.mock('../src/math', () => ({
  ...jest.requireActual<typeof import('../src/math')>('../src/math'),
  add: jest.fn(() => 0),
}));

it('keeps the original around a factory mock', () => {
  expect(add(1, 1)).toBe(0);
  expect(double(2)).toBe(4);
});
