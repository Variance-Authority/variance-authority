import { expect, it } from 'vitest';
import { render } from '../src/limits';

it('renders', () => {
  expect(render()).toContain('10');
});
