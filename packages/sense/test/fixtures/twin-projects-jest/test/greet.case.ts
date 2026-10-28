import { greet } from '../src/greet';

it('greets by name', () => {
  expect(greet('ada')).toBe('hello, ada');
});
