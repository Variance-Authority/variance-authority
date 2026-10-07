// compass: variance-authority.report.shard-merge
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Write through a temporary file and a rename, so a reader never opens half of one. */
export async function settle(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${String(process.pid)}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
}
