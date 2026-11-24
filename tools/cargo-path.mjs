import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export function cargoPath() {
  return [process.env.CARGO, 'cargo', join(process.env.HOME ?? '', '.cargo', 'bin', 'cargo')]
    .filter(Boolean)
    .find((candidate) => spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0);
}
