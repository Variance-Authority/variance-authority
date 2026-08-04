import { defineConfig } from 'vitest/config';

/**
 * Repository checks: is this checkout in a legal state?
 *
 * Separate from `vitest.config.ts` because these are not tests. Nothing here has
 * a subject or exercises a behaviour — they read the repository as data and
 * assert rules about it: every link resolves, every package declares what it
 * imports, no file exceeds five hundred lines, no test drives a compiler.
 *
 * Same runner, because assertions and reporting are exactly what a test runner
 * is good at, and a hand-rolled one would be a worse version of it. Different
 * command, because the two answer different questions and a reader has to be
 * able to tell which one just failed. `.check.ts` rather than `.test.ts` so the
 * distinction survives someone opening the file rather than the config.
 */

export default defineConfig({
  test: {
    include: ['tools/**/*.check.ts'],
    environment: 'node',
  },
});
