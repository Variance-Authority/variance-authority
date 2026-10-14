import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const module = pathToFileURL(resolve('packages/cli/dist/index-progress.js')).href;
function run(work: string): Promise<{ stdout: string; stderr: string; firstProgress: number | undefined; finished: number }> {
  return new Promise((done, reject) => {
    const started = Date.now();
    const child = spawn(process.execPath, ['--input-type=module', '-e', `import { indexProgress } from ${JSON.stringify(module)};
      const progress = indexProgress(); try { ${work} } finally { await progress.stop(); }`]);
    let stdout = '', stderr = '', firstProgress: number | undefined;
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); firstProgress ??= Date.now() - started; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? done({ stdout, stderr, firstProgress, finished: Date.now() - started }) : reject(new Error(stderr)));
  });
}

describe('index progress', () => {
  it('starts after five seconds even while the indexing thread cannot run timers', async () => {
    const result = await run("Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000); console.log('artifact output');");
    expect(result.stdout).toBe('artifact output\n');
    expect(result.stderr).toContain('indexing source and documentation');
    expect(result.firstProgress).toBeGreaterThanOrEqual(4900);
    expect(result.firstProgress).toBeLessThan(result.finished - 300);
  }, 10000);

  it('stays quiet for quick work, and closes on an error handled by its caller', async () => {
    for (const work of ["console.log('artifact output');", "try { throw new Error('refused'); } catch { console.log('refused'); }"]) {
      const result = await run(work);
      expect(result.stderr).toBe('');
      expect(result.finished).toBeLessThan(5000);
    }
  });
});
