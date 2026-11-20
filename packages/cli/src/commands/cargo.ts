// compass: variance-authority.reach
/** `variance cargo`: run a Cargo suite's tests one per process and record what each ran, which `recordCargo` owns. */

import { recordCargo } from '@variance-authority/sense/test-selection';
import type { ParsedCargo } from '../cargo-args.js';

/** Cargo's exit when a test or the build failed, kept so a script reads it as it reads `cargo test`'s. */
const CARGO_FAILED = 101;

/** Record `parsed`'s suite, answering 0 when every test passed and Cargo's failure exit otherwise. */
export async function runCargo({ suite, args }: ParsedCargo, cwd = process.cwd()): Promise<number> {
  const failed = await recordCargo({ cwd, suite, args });
  return failed === 0 ? 0 : CARGO_FAILED;
}
