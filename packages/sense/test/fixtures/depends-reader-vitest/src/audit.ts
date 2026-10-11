/// <depends path="./fee.ts" />
import { readFileSync } from 'node:fs';

export function feeIsLiteral(): boolean {
  return /FEE = \d+;/.test(readFileSync(new URL('./fee.ts', import.meta.url), 'utf8'));
}
