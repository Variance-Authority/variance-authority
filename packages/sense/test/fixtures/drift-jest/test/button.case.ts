import { label } from '../src/button';

it('labels through the mapped style and the aliased module', () => {
  expect(label(1)).toBe('primary:2');
});
