// compass: variance-authority.reach
/** `variance python`: run a pytest suite and record which functions each test ran, which `recordPython` owns. */

import { recordPython } from '@variance-authority/sense/test-selection';
import type { ParsedPython } from '../python-args.js';

/** Pytest's exit when a test failed, kept so a script reads it as it reads `pytest`'s. */
const PYTEST_FAILED = 1;

/** Record `parsed`'s suite, answering 0 when every test passed and pytest's failure exit otherwise. */
export async function runPython({ suite, args }: ParsedPython, cwd = process.cwd()): Promise<number> {
  const failed = await recordPython({ cwd, suite, args });
  return failed === 0 ? 0 : PYTEST_FAILED;
}
