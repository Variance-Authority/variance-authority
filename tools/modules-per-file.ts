import { beforeEach } from 'vitest';
import { configureResetHandler } from '@variance-authority/ioc/reset/setup';

/**
 * Under `tools/shared-modules.config.mts`, every module a test reaches is put
 * back to the values it loaded with before the test starts, as the isolator
 * README's Vitest setup does.
 */
configureResetHandler(beforeEach);
