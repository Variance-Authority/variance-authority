import { runInNewContext } from 'node:vm';

// A page as Playwright's is to a function handed to it: the function crosses as
// its text and runs where none of this module's bindings exist.
export const page = {
  evaluate: (fn, argument) =>
    runInNewContext(`(${fn.toString()})(argument)`, { argument, document: { title: 'Home', items: ['a', 'b', 'c'] } }),
};
