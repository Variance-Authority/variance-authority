import { aroundEach, beforeEach } from 'vitest';
import { configureResetHandler } from '@variance-authority/ioc/reset/setup';

// Vitest runs a setup file again for every test file, on a module graph it
// keeps under `isolate: false`: from the second file on, the application
// modules have already registered their handlers with the driver this installed.
configureResetHandler(beforeEach);

// Tests that run side by side share whatever session the last `beforeEach`
// started, so each concurrent test runs in a session of its own, through every
// `await`. The isolator registers its reset as it loads, so it is imported once
// the driver is installed.
const { isolated } = await import('@variance-authority/isolator/node');
aroundEach((runTest, { task }) => (task.concurrent === true ? isolated(runTest) : runTest()));
