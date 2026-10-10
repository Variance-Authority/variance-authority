import { expect, it } from 'vitest';
import { collect } from '../src/collector';

it('collects through the harness', () => {
  expect(collect()).toEqual(['page', 'load,pageerror', 'title']);
});
