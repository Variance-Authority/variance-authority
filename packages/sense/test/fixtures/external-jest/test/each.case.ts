import { decide } from '../src/decide';

it.each([
  ['alpha', 'A'],
  ['beta', 'B'],
])('takes the %s path from a table', (choice, expected) => {
  expect(decide(choice)).toBe(expected);
});
