import { fileURLToPath } from 'node:url';
import { isolator } from '@variance-authority/isolator/vite';
import { defineConfig } from 'vitest/config';

// The isolator README's Vitest config, over a file that mocks a module another
// file loads first. FIXTURE_SPLIT=false runs every file in the shared project.
// Files run in the order of their paths, so `a.case.ts` loads the module first.
// The root names no `include`: a project that extends it would add its own to it.
const root = fileURLToPath(new URL('.', import.meta.url));
const split = process.env['FIXTURE_SPLIT'] !== 'false';

// Files whose modules must load after something the file does first.
const isolated = ['src/**/*.mocked.case.ts'];

export default defineConfig({
  root,
  plugins: [isolator()],
  test: {
    pool: 'forks',
    fileParallelism: false,
    setupFiles: ['./reset.setup.ts'],
    sequence: {
      sequencer: class {
        async shard<T>(files: T[]) {
          return files;
        }
        async sort<T extends { moduleId: string }>(files: T[]) {
          return [...files].sort((left, right) => (left.moduleId < right.moduleId ? -1 : left.moduleId > right.moduleId ? 1 : 0));
        }
      },
    },
    projects: split
      ? [
          { extends: true, test: { name: 'shared', isolate: false, include: ['src/**/*.case.ts'], exclude: isolated } },
          { extends: true, test: { name: 'isolated', include: isolated } },
        ]
      : [{ extends: true, test: { name: 'shared', isolate: false, include: ['src/**/*.case.ts'] } }],
  },
});
