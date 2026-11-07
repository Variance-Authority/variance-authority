import { describe, expect, it } from 'vitest';
import { readJobTrace } from './job-trace.js';

const read = (...lines: string[]) => {
  const { reads, writes } = readJobTrace(lines);
  return { reads: [...reads], writes: [...writes] };
};

describe('reading a job trace', () => {
  it('reads an open for reading, by the path the kernel resolved', () => {
    expect(read('144   openat(AT_FDCWD</r/sub>, "../read.txt", O_RDONLY) = 3</r/read.txt>').reads).toEqual(['/r/read.txt']);
  });

  it('counts a program a job ran as read', () => {
    expect(read('144   execve("/r/bin/tool", ["tool", "a b"], 0x7ffd /* 3 vars */) = 0').reads).toEqual(['/r/bin/tool']);
  });

  it('writes an open for writing, and reads none of it', () => {
    expect(read('146   openat(AT_FDCWD</r/sub>, "../gen.txt", O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC, 0666) = 3</r/gen.txt>')).toEqual({
      reads: [],
      writes: ['/r/gen.txt'],
    });
  });

  it('holds a file written before it was read as an output alone', () => {
    expect(read(
      '1 openat(AT_FDCWD</r>, "gen.txt", O_WRONLY|O_CREAT|O_TRUNC, 0666) = 3</r/gen.txt>',
      '2 openat(AT_FDCWD</r>, "gen.txt", O_RDONLY) = 4</r/gen.txt>',
    )).toEqual({ reads: [], writes: ['/r/gen.txt'] });
  });

  it('holds a file read before it was written as both', () => {
    expect(read(
      '1 openat(AT_FDCWD</r>, "a.txt", O_RDONLY) = 3</r/a.txt>',
      '1 openat(AT_FDCWD</r>, "a.txt", O_WRONLY) = 3</r/a.txt>',
    )).toEqual({ reads: ['/r/a.txt'], writes: ['/r/a.txt'] });
  });

  it('counts a write that keeps what was there as a read of it too', () => {
    expect(read('1 openat(AT_FDCWD</r>, "log.txt", O_WRONLY|O_APPEND) = 3</r/log.txt>')).toEqual({
      reads: ['/r/log.txt'],
      writes: ['/r/log.txt'],
    });
  });

  it('counts a truncate that keeps a prefix as a read, and one that empties the file as none', () => {
    expect(read('1 truncate("/r/kept.txt", 4) = 0')).toEqual({ reads: ['/r/kept.txt'], writes: ['/r/kept.txt'] });
    expect(read('1 truncate("/r/gone.txt", 0) = 0')).toEqual({ reads: [], writes: ['/r/gone.txt'] });
  });

  it('follows a rename from its directories, and what it wrote moves with it', () => {
    expect(read(
      '147 openat(AT_FDCWD</r/sub>, "\\303\\251 q.tmp", O_WRONLY|O_CREAT|O_TRUNC, 0666) = 3</r/sub/\\303\\251 q.tmp>',
      '147 renameat2(AT_FDCWD</r/sub>, "\\303\\251 q.tmp", AT_FDCWD</r/sub>, "final.txt", RENAME_NOREPLACE) = 0',
      '147 openat(AT_FDCWD</r/sub>, "final.txt", O_RDONLY) = 3</r/sub/final.txt>',
    )).toEqual({ reads: [], writes: ['/r/sub/final.txt', '/r/sub/é q.tmp'] });
  });

  it('counts a file moved away that the job did not write as read', () => {
    expect(read('1 rename("/r/a.txt", "/r/b.txt") = 0')).toEqual({ reads: ['/r/a.txt'], writes: ['/r/a.txt', '/r/b.txt'] });
  });

  it('joins a call the trace split across another process', () => {
    expect(read(
      '10 openat(AT_FDCWD</r>, "a.txt", O_RDONLY <unfinished ...>',
      '11 openat(AT_FDCWD</r>, "b.txt", O_RDONLY) = 3</r/b.txt>',
      '10 <... openat resumed>) = 4</r/a.txt>',
    ).reads).toEqual(['/r/a.txt', '/r/b.txt']);
  });

  it('reads nothing from a call that failed, a descriptor that only names a file, or a line that is no call', () => {
    expect(read(
      '1 openat(AT_FDCWD</r>, "x", O_RDONLY) = -1 EACCES (Permission denied)',
      '1 openat(AT_FDCWD</r>, "p", O_RDONLY|O_PATH) = 3</r/p>',
      '1 openat(AT_FDCWD</r>, "y", O_RDONLY) = -1 ENOENT (No such file or directory)',
      '1 --- SIGCHLD {si_signo=SIGCHLD, si_code=CLD_EXITED, si_pid=2} ---',
      '1 +++ exited with 0 +++',
      '',
    )).toEqual({ reads: [], writes: [] });
  });

  it('keeps a quote, a parenthesis and a comma inside a path', () => {
    expect(read('1 openat(AT_FDCWD</r>, "a\\"(b), c.txt", O_RDONLY) = 3</r/a"(b), c.txt>').reads).toEqual(['/r/a"(b), c.txt']);
  });
});
