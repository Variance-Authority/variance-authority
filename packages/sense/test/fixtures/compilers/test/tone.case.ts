import { label } from '../src/tone';

it('labels a pressed button red and a released one blue', () => {
  expect(label(true)).toBe('red');
  expect(label(false)).toBe('blue');
});
