import { label, shade } from '../src/tone';

it('labels a pressed button red and a released one blue', () => {
  expect(label(true)).toBe('red');
  expect(label(false)).toBe('blue');
});

it('shades a light button, and never a dark one', () => {
  expect(shade(false)).toBe('blue');
});
