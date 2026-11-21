// `node --test` without its CLI: the CLI globs its arguments with `fs`
// functions captured before any preload (`lib/internal/fs/glob.js`), so a
// file only the manifest holds is never found. `run({ files })` skips the glob.
import { run } from 'node:test';
import { tap } from 'node:test/reporters';

const stream = run({ files: process.argv.slice(2) });
stream.on('test:fail', () => (process.exitCode = 1));
stream.compose(tap).pipe(process.stdout);
