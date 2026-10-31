import { beforeAll } from 'vitest';
import { configureResetHandler } from '@variance-authority/ioc/reset/setup';

/**
 * Under `tools/shared-modules.config.mts`, every module a file reaches is put
 * back to the values it loaded with before the file starts: what a fresh module
 * graph per file gave it. Within a file, its tests share them, as they do in
 * the recorded run.
 */
configureResetHandler(beforeAll);
