import { next, size } from '../src/counter';
import { mode } from '../src/mode';

// A test file's own variable is the file's to share between its tests.
let local = 0;

it('counts from one', () => {
  local += 1;
  expect([next(), next(), size(), mode]).toEqual([1, 2, 2, 'quiet']);
});

it('counts from one again, whatever the test before it left', () => {
  local += 1;
  expect([next(), size(), local]).toEqual([1, 1, 2]);
});
