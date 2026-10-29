import { double } from '../src/math';
import { label } from '../src/button';

jest.unmock('../src/button');

it('stubs what automock stubs and runs what it opts out', () => {
  expect(double(2)).toBeUndefined();
  expect(label(1)).toBe('primary:undefined');
});
