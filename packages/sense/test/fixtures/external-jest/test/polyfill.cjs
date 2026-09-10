// The project's own `setupFiles` entry, which loads an instrumented module
// before the test framework is even installed: the counter factory has to be
// there ahead of it.
const { decide } = require('../src/decide.ts');

if (typeof decide !== 'function') throw new Error('polyfill could not load src/decide.ts');
