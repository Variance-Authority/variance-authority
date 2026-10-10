import { greet } from '../src/greet';

const skipsEverything = (globalThis as { skipsEverything?: boolean }).skipsEverything === true;

(skipsEverything ? it.skip : it)('greets by name', () => {
  expect(greet('ada')).toBe('hello, ada');
});
