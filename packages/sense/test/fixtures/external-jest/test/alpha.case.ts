import { decide } from '../src/decide';

it('takes the alpha path', () => {
  expect(decide('alpha')).toBe('A');
});

it('ran after the project\'s own setup file', () => {
  expect((globalThis as { __FIXTURE_SETUP__?: string }).__FIXTURE_SETUP__).toBe('composed');
});

it.skip('makes the file observation visibly partial', () => {
  expect(decide('beta')).toBe('B');
});
