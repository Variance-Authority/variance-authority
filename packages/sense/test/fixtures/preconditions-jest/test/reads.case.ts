import { buttonLabel, checkoutOn } from '../src/flags';

it('reads the flag on', () => {
  expect(checkoutOn({ checkout: true })).toBe(true);
});

it('reads the flag both ways', () => {
  expect([checkoutOn({ checkout: true }), checkoutOn({})]).toEqual([true, false]);
});

it('reads only what the file read as it loaded', () => {
  expect(buttonLabel()).toBe('Pay');
});
