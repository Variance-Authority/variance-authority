// The project's own setup file, which loads an instrumented module before any
// test does: the counter factory has to be installed ahead of it.
import { decide } from '../src/decide.js';

if (typeof decide !== 'function') throw new Error('setup could not load src/decide.ts');
