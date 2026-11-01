import { lookup } from '../../src/registry';
import '../../src/plugin';

// The registry loads first and the plugin registers into it as this file is
// collected: a fresh file keeps that registration for every test.
it('sees what a module registered as the file loaded it', () => {
  expect(lookup('plugin')).toBe('loaded');
});

it('sees it again in the next test', () => {
  expect(lookup('plugin')).toBe('loaded');
});
