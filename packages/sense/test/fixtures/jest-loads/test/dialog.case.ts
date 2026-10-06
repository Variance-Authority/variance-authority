import { click, open } from '../src/dialog';

it('opens', () => {
  expect(open()).toBe('open');
});
it('confirms on click', () => {
  expect(click(true)).toBe('yes');
});
it('opens twice', () => {
  expect(open() + open()).toBe('openopen');
});
