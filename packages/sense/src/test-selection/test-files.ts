import { relative, resolve, sep } from 'node:path';
import picomatch from 'picomatch';

/** The default test glob of Vitest and of Rstest, the same in every major these seams support. */
const TEST_INCLUDE = ['**/*.{test,spec}.?(c|m)[jt]s?(x)'];

/**
 * Which files a runner's configuration runs as tests: its `include` globs,
 * under `dir` resolved against the configuration's root, as the runner's own
 * search reads them, never one under `node_modules`.
 */
export function testFilesAt(
  configRoot: string,
  dir: string | undefined,
  include: readonly string[] = TEST_INCLUDE,
): (file: string) => boolean {
  const under = resolve(configRoot, dir ?? '.');
  const matches = picomatch([...include], { dot: true });
  return (file) => {
    const path = relative(under, file).split(sep).join('/');
    return !path.startsWith('../') && !path.split('/').includes('node_modules') && matches(path);
  };
}
