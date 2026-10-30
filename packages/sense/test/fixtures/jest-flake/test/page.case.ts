import { handle, wire } from '../src/page';

it('clicks', () => {
  if (process.env['CLICK_FIRST'] !== '1') wire();
  expect(handle()).toBe('handled');
});
