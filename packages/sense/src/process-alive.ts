/**
 * Whether the process `pid` is running, as signal 0 answers: refused is a
 * process this user may not signal, which runs, and so is somebody else's
 * process under a reused id.
 */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
