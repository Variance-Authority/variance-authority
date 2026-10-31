import { aroundEach, beforeEach } from 'vitest';
import { configureResetHandler } from '@variance-authority/ioc/reset/setup';

/**
 * Under `tools/shared-modules.config.mts`, every module a test reaches is put
 * back to the values it loaded with before the test starts, and every concurrent
 * test runs in a session of its own, as the isolator README's Vitest setup does.
 */
configureResetHandler(beforeEach);

const { isolated } = await import('@variance-authority/isolator/node');
aroundEach((runTest, { task }) => (task.concurrent === true ? isolated(runTest) : runTest()));
