import { evaluatedIn, loudGreet } from '../src/greet';

it('greets first', () => {
  expect(loudGreet('a')).toBe('[greet] hi a');
  expect(evaluatedIn).toBe(process.env['VARIANCE_AUTHORITY_INLINE_REQUIRES'] === '1' ? 'greets first' : undefined);
});
it('greets again', () => {
  expect(loudGreet('b')).toBe('[greet] hi b');
});
it('greets nobody', () => {
  expect(true).toBe(true);
});
